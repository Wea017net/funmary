// 送信待ち (配信)。通知欄の通知を、利用者のチャネルごとに 1 件ずつ作り、送れたか、いつ再送するかを持つ。
// 同じ通知と同じチャネルの組は 1 行だけなので、二重に作っても二重には届かない
import { and, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { DEFAULT_CHANNEL_KINDS } from './channel-store.ts';
import type { Database } from './database.ts';
import { kindSetting, parseKindSettings } from './discord-link-store.ts';
import type { NotificationKind } from './notification-store.ts';
import { channels, deliveries, discordLinks, notifications, users } from './schema.ts';
import type { SecretBox } from './secrets.ts';

/** 取りこぼしていても、これより古い通知は送らない (止まっていたあとに、古い知らせをまとめて送らないため) */
const ENQUEUE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 続けて失敗した数を数える最大の件数 */
const STREAK_LOOKBACK = 20;

/** Discord 連携の送り先。both なら 2 件になる (#163) */
export interface LinkDestination {
	readonly channelId: string;
	/** メンションする相手の Discord のユーザー ID。しなければ null */
	readonly mentionUserId: string | null;
}

export type DeliveryTarget =
	| { readonly kind: 'webhook'; readonly url: string; readonly signingKey: string | null }
	| { readonly kind: 'link'; readonly destinations: readonly LinkDestination[] };

export interface PendingDelivery {
	readonly id: number;
	/** これまでに試した回数 */
	readonly attempts: number;
	readonly channelId: number;
	readonly userId: string;
	readonly channelKind: 'discord' | 'generic' | 'discordLink';
	readonly notification: {
		readonly id: number;
		readonly kind: NotificationKind;
		readonly title: string;
		readonly body: string | null;
		readonly link: string | null;
		readonly subjectId: number | null;
		/** 授業の日付 (YYYY-MM-DD)。休講などの通知のときだけ持つ。汎用 Webhook の構造化データに使う */
		readonly date: string | null;
		/** 授業の時限。休講などの通知のときだけ持つ */
		readonly period: number | null;
		readonly createdAt: Date;
	};
	/** 送り先。Discord 連携が解除されていて、送り先が引けないときは null */
	readonly target: DeliveryTarget | null;
}

/** 管理画面の「配信の失敗」に出す、1 件分 */
export interface FailedDelivery {
	readonly id: number;
	/** 試した回数 (上限に尽きたか、送り先が止まったかの両方を含む) */
	readonly attempts: number;
	readonly userEmail: string;
	readonly channelKind: 'discord' | 'generic' | 'discordLink';
	readonly notificationKind: NotificationKind;
	readonly title: string;
	readonly lastError: string | null;
	/** チャネルを止めたことで失敗にしたものは、失敗の時刻を記録していないので null */
	readonly failedAt: Date | null;
}

export interface RetryPlan {
	readonly attempts: number;
	readonly nextAttemptAt: Date;
	readonly error: string;
}

export interface DeliveryStore {
	/** 通知に対する送信待ちを、足りない分だけ作る。作った数を返す */
	enqueueMissing(now: Date): number;
	/** 今送る番の送信待ち。古い順 */
	claimDue(now: Date, limit: number): PendingDelivery[];
	markSent(id: number, now: Date): void;
	markRetry(id: number, plan: RetryPlan): void;
	markFailed(id: number, now: Date, error: string): void;
	/** そのチャネルで、直近の配信が続けて失敗した数 (成功で途切れる) */
	failureStreak(channelId: number): number;
	/** 直近に失敗した配信。新しい順 */
	recentFailed(limit: number): FailedDelivery[];
}

export function createDeliveryStore(database: Database, secretBox: SecretBox): DeliveryStore {
	const { db, sqlite } = database;

	return {
		enqueueMissing(now) {
			const since = new Date(now.getTime() - ENQUEUE_WINDOW_MS);
			return sqlite.transaction(() => {
				const recent = db
					.select()
					.from(notifications)
					.where(lte(notifications.createdAt, now))
					.all()
					.filter((row) => row.createdAt >= since);
				if (recent.length === 0) return 0;
				const userIds = [...new Set(recent.map((row) => row.userId))];
				const active = db
					.select()
					.from(channels)
					.where(and(inArray(channels.userId, userIds), eq(channels.status, 'active')))
					.all();
				let created = 0;
				for (const notification of recent) {
					for (const channel of active) {
						if (channel.userId !== notification.userId) continue;
						if (channel.createdAt > notification.createdAt) continue;
						const kinds = channel.notificationKinds ?? DEFAULT_CHANNEL_KINDS;
						if (!kinds.includes(notification.kind as NotificationKind)) continue;
						created += db
							.insert(deliveries)
							.values({ notificationId: notification.id, channelId: channel.id })
							.onConflictDoNothing()
							.run().changes;
					}
				}
				return created;
			})();
		},
		claimDue(now, limit) {
			const rows = db
				.select({
					id: deliveries.id,
					attempts: deliveries.attempts,
					channelId: channels.id,
					userId: channels.userId,
					channelKind: channels.kind,
					configEncrypted: channels.configEncrypted,
					notification: notifications,
					linkThreadChannelId: discordLinks.threadChannelId,
					linkDmChannelId: discordLinks.dmChannelId,
					linkKindSettings: discordLinks.kindSettings,
					linkDiscordUserId: discordLinks.discordUserId,
				})
				.from(deliveries)
				.innerJoin(notifications, eq(notifications.id, deliveries.notificationId))
				.innerJoin(channels, eq(channels.id, deliveries.channelId))
				.leftJoin(discordLinks, eq(discordLinks.userId, channels.userId))
				.where(
					and(
						eq(deliveries.status, 'pending'),
						eq(channels.status, 'active'),
						or(isNull(deliveries.nextAttemptAt), lte(deliveries.nextAttemptAt, now)),
					),
				)
				.orderBy(deliveries.id)
				.limit(limit)
				.all();
			return rows.map((row): PendingDelivery => {
				const channelKind = row.channelKind as 'discord' | 'generic' | 'discordLink';
				let target: DeliveryTarget | null = null;
				if (channelKind === 'discord' || channelKind === 'generic') {
					const { url, signingKey } = JSON.parse(secretBox.decrypt(row.configEncrypted)) as {
						url: string;
						signingKey?: string | null;
					};
					target = { kind: 'webhook', url, signingKey: signingKey ?? null };
				} else if (row.linkDiscordUserId !== null) {
					const kind = row.notification.kind as NotificationKind;
					const setting = kindSetting(parseKindSettings(row.linkKindSettings), kind);
					const mentionUserId = setting.mention ? row.linkDiscordUserId : null;
					const destinations: LinkDestination[] = [];
					if (
						(setting.destination === 'thread' || setting.destination === 'both') &&
						row.linkThreadChannelId !== null
					) {
						destinations.push({ channelId: row.linkThreadChannelId, mentionUserId });
					}
					if (
						(setting.destination === 'dm' || setting.destination === 'both') &&
						row.linkDmChannelId !== null
					) {
						destinations.push({ channelId: row.linkDmChannelId, mentionUserId });
					}
					if (destinations.length > 0) target = { kind: 'link', destinations };
				}
				return {
					id: row.id,
					attempts: row.attempts,
					channelId: row.channelId,
					userId: row.userId,
					channelKind,
					notification: {
						id: row.notification.id,
						kind: row.notification.kind as NotificationKind,
						title: row.notification.title,
						body: row.notification.body,
						link: row.notification.link,
						subjectId: row.notification.subjectId,
						date: row.notification.date,
						period: row.notification.period,
						createdAt: row.notification.createdAt,
					},
					target,
				};
			});
		},
		markSent(id, now) {
			db.update(deliveries)
				.set({ status: 'sent', sentAt: now, nextAttemptAt: null, lastError: null })
				.where(eq(deliveries.id, id))
				.run();
		},
		markRetry(id, plan) {
			db.update(deliveries)
				.set({ attempts: plan.attempts, nextAttemptAt: plan.nextAttemptAt, lastError: plan.error })
				.where(eq(deliveries.id, id))
				.run();
		},
		markFailed(id, now, error) {
			db.update(deliveries)
				.set({ status: 'failed', nextAttemptAt: null, lastError: error, failedAt: now })
				.where(eq(deliveries.id, id))
				.run();
		},
		failureStreak(channelId) {
			const recent = db
				.select({ status: deliveries.status })
				.from(deliveries)
				.where(
					and(eq(deliveries.channelId, channelId), inArray(deliveries.status, ['sent', 'failed'])),
				)
				.orderBy(desc(deliveries.id))
				.limit(STREAK_LOOKBACK)
				.all();
			const firstOk = recent.findIndex((row) => row.status === 'sent');
			return firstOk === -1 ? recent.length : firstOk;
		},
		recentFailed(limit) {
			return db
				.select({
					id: deliveries.id,
					attempts: deliveries.attempts,
					userEmail: users.email,
					channelKind: channels.kind,
					notificationKind: notifications.kind,
					title: notifications.title,
					lastError: deliveries.lastError,
					failedAt: deliveries.failedAt,
				})
				.from(deliveries)
				.innerJoin(notifications, eq(notifications.id, deliveries.notificationId))
				.innerJoin(channels, eq(channels.id, deliveries.channelId))
				.innerJoin(users, eq(users.id, channels.userId))
				.where(eq(deliveries.status, 'failed'))
				.orderBy(desc(deliveries.id))
				.limit(limit)
				.all()
				.map((row): FailedDelivery => ({
					id: row.id,
					attempts: row.attempts,
					userEmail: row.userEmail,
					channelKind: row.channelKind as 'discord' | 'generic' | 'discordLink',
					notificationKind: row.notificationKind as NotificationKind,
					title: row.title,
					lastError: row.lastError,
					failedAt: row.failedAt,
				}));
		},
	};
}
