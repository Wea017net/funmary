// 利用者が登録した通知の送り先 (チャネル、設計書 14.3)。Webhook の URL は暗号化して保存し、読み出すときだけ復号する。
// Discord 連携 (Bot が送る) の送り先は、連携のたびに利用者へ作って、解除したら消す (discordLink)
import { and, count, eq, notInArray } from 'drizzle-orm';
import type { Database } from './database.ts';
import type { NotificationKind } from './notification-store.ts';
import { channels, deliveries, discordLinks } from './schema.ts';
import type { SecretBox } from './secrets.ts';

/** 送る種類を決めていないチャネルに送る通知の種類 (設計書 14.7)。休講など、連携の不具合 */
export const DEFAULT_CHANNEL_KINDS: readonly NotificationKind[] = [
	'cancellation',
	'makeup',
	'roomChange',
	'integration',
];

export type ChannelStatus = 'active' | 'disabled';

export interface StoredWebhook {
	readonly id: number;
	readonly userId: string;
	/** 暗号化を解いた URL。画面には伏せて出す */
	readonly url: string;
	readonly label: string | null;
	/** null なら既定の種類 (DEFAULT_CHANNEL_KINDS) */
	readonly notificationKinds: readonly NotificationKind[] | null;
	readonly status: ChannelStatus;
	readonly disabledReason: string | null;
	readonly createdAt: Date;
}

export interface NewWebhook {
	readonly url: string;
	readonly label: string | null;
	readonly notificationKinds: readonly NotificationKind[] | null;
}

export interface WebhookChanges {
	readonly label?: string | null;
	readonly notificationKinds?: readonly NotificationKind[] | null;
	/** true なら有効に戻し、止めた理由を消す。false なら止める */
	readonly enabled?: boolean;
}

export interface DiscordLinkChannel {
	/** null なら既定の種類 (DEFAULT_CHANNEL_KINDS) */
	readonly notificationKinds: readonly NotificationKind[] | null;
}

export interface ChannelStore {
	addWebhook(userId: string, input: NewWebhook, now: Date): StoredWebhook;
	/** 古い順 */
	listWebhooks(userId: string): StoredWebhook[];
	findWebhook(userId: string, id: number): StoredWebhook | null;
	/** 止められたものを含めた、登録済みの数 */
	countWebhooks(userId: string): number;
	/** その人の Webhook なら更新して返す。ほかの人のものや、無いものは null */
	updateWebhook(userId: string, id: number, changes: WebhookChanges): StoredWebhook | null;
	removeWebhook(userId: string, id: number): boolean;
	/** チャネルを止め、まだ送っていない配信を失敗にする (再送しても直らない失敗のとき) */
	disable(channelId: number, reason: string): void;
	/** 連携した人には Discord 連携の送り先を作り、連携を解除した人の分は消す */
	syncLinkChannels(now: Date): void;
	/** 利用者の Discord 連携の送り先 (設計書 14.9、#163)。連携していなければ null */
	discordLinkChannel(userId: string): DiscordLinkChannel | null;
	/** 届ける通知の種類を変える。連携していなければ false */
	updateDiscordLinkKinds(userId: string, kinds: readonly NotificationKind[] | null): boolean;
}

type Row = typeof channels.$inferSelect;

export function createChannelStore(database: Database, secretBox: SecretBox): ChannelStore {
	const { db, sqlite } = database;

	const toWebhook = (row: Row): StoredWebhook => ({
		id: row.id,
		userId: row.userId,
		url: (JSON.parse(secretBox.decrypt(row.configEncrypted)) as { url: string }).url,
		label: row.label,
		notificationKinds: row.notificationKinds as NotificationKind[] | null,
		status: row.status,
		disabledReason: row.disabledReason,
		createdAt: row.createdAt,
	});

	const find = (userId: string, id: number) =>
		db
			.select()
			.from(channels)
			.where(and(eq(channels.id, id), eq(channels.userId, userId), eq(channels.kind, 'discord')))
			.get();

	return {
		addWebhook(userId, input, now) {
			const row = db
				.insert(channels)
				.values({
					userId,
					kind: 'discord',
					configEncrypted: secretBox.encrypt(JSON.stringify({ url: input.url })),
					label: input.label,
					notificationKinds: input.notificationKinds ? [...input.notificationKinds] : null,
					createdAt: now,
				})
				.returning()
				.get();
			return toWebhook(row);
		},
		listWebhooks(userId) {
			return db
				.select()
				.from(channels)
				.where(and(eq(channels.userId, userId), eq(channels.kind, 'discord')))
				.orderBy(channels.id)
				.all()
				.map(toWebhook);
		},
		findWebhook(userId, id) {
			const row = find(userId, id);
			return row ? toWebhook(row) : null;
		},
		countWebhooks(userId) {
			return (
				db
					.select({ count: count() })
					.from(channels)
					.where(and(eq(channels.userId, userId), eq(channels.kind, 'discord')))
					.get()?.count ?? 0
			);
		},
		updateWebhook(userId, id, changes) {
			if (!find(userId, id)) return null;
			const set: Partial<typeof channels.$inferInsert> = {};
			if (changes.label !== undefined) set.label = changes.label;
			if (changes.notificationKinds !== undefined) {
				set.notificationKinds = changes.notificationKinds ? [...changes.notificationKinds] : null;
			}
			if (changes.enabled === true) {
				set.status = 'active';
				set.disabledReason = null;
			} else if (changes.enabled === false) {
				set.status = 'disabled';
			}
			if (Object.keys(set).length > 0) {
				db.update(channels).set(set).where(eq(channels.id, id)).run();
			}
			return toWebhook(find(userId, id)!);
		},
		removeWebhook(userId, id) {
			if (!find(userId, id)) return false;
			db.delete(channels).where(eq(channels.id, id)).run();
			return true;
		},
		disable(channelId, reason) {
			sqlite.transaction(() => {
				db.update(channels)
					.set({ status: 'disabled', disabledReason: reason })
					.where(eq(channels.id, channelId))
					.run();
				db.update(deliveries)
					.set({ status: 'failed', lastError: reason, nextAttemptAt: null })
					.where(and(eq(deliveries.channelId, channelId), eq(deliveries.status, 'pending')))
					.run();
			})();
		},
		syncLinkChannels(now) {
			sqlite.transaction(() => {
				const linked = db
					.select({ userId: discordLinks.userId, linkedAt: discordLinks.createdAt })
					.from(discordLinks)
					.all();
				const have = db.select().from(channels).where(eq(channels.kind, 'discordLink')).all();
				const haveByUser = new Map(have.map((row) => [row.userId, row]));
				for (const { userId, linkedAt } of linked) {
					const existing = haveByUser.get(userId);
					if (existing) {
						// 止めたあとに連携し直したら、送り先を有効に戻す (連携の時刻が、送り先を作ったあとなら、やり直したとき)
						if (existing.status === 'disabled' && linkedAt > existing.createdAt) {
							db.update(channels)
								.set({ status: 'active', disabledReason: null, createdAt: now })
								.where(eq(channels.id, existing.id))
								.run();
						}
						continue;
					}
					db.insert(channels)
						.values({
							userId,
							kind: 'discordLink',
							configEncrypted: secretBox.encrypt('{}'),
							createdAt: now,
						})
						.run();
				}
				const linkedIds = linked.map((row) => row.userId);
				db.delete(channels)
					.where(
						and(
							eq(channels.kind, 'discordLink'),
							linkedIds.length > 0 ? notInArray(channels.userId, linkedIds) : undefined,
						),
					)
					.run();
			})();
		},
		discordLinkChannel(userId) {
			const row = db
				.select({ notificationKinds: channels.notificationKinds })
				.from(channels)
				.where(and(eq(channels.userId, userId), eq(channels.kind, 'discordLink')))
				.get();
			return row ? { notificationKinds: row.notificationKinds as NotificationKind[] | null } : null;
		},
		updateDiscordLinkKinds(userId, kinds) {
			const changes = db
				.update(channels)
				.set({ notificationKinds: kinds ? [...kinds] : null })
				.where(and(eq(channels.userId, userId), eq(channels.kind, 'discordLink')))
				.run().changes;
			return changes > 0;
		},
	};
}
