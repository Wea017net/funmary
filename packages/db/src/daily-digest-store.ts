// 予定のまとめ (#207) の、利用者ごとの設定と、前に送った日。
import type { CalendarDate, DailyDigestSettings } from '@funmary/core';
import { DEFAULT_DAILY_DIGEST_SETTINGS } from '@funmary/core';
import { eq } from 'drizzle-orm';
import type { Database } from './database.ts';
import { dailyDigestSettings, discordLinks } from './schema.ts';

export interface DailyDigestRecipient {
	readonly userId: string;
	/** Discord の送り先 (本人だけのスレッドか DM のチャンネル) */
	readonly channelId: string;
	readonly settings: DailyDigestSettings;
	readonly lastSentFor: CalendarDate | null;
}

export interface DailyDigestStore {
	/** 利用者の設定。保存していなければ既定の設定 */
	get(userId: string): DailyDigestSettings;
	save(userId: string, settings: DailyDigestSettings, now: Date): void;
	/** Discord と連携している利用者全員 (まとめを無効にした人も含む。送るかどうかは呼び出し側で決める) */
	listRecipients(): DailyDigestRecipient[];
	/** date の分のまとめを送ったことを記録する */
	markSent(userId: string, date: CalendarDate, now: Date): void;
}

type Row = typeof dailyDigestSettings.$inferSelect;

const toSettings = (row: Row): DailyDigestSettings => ({
	enabled: row.enabled,
	timing: row.timing,
	customTime: row.customTime,
	customDay: row.customDay,
	sendWhenEmpty: row.sendWhenEmpty,
});

export function createDailyDigestStore(database: Database): DailyDigestStore {
	const { db } = database;

	return {
		get(userId) {
			const row = db
				.select()
				.from(dailyDigestSettings)
				.where(eq(dailyDigestSettings.userId, userId))
				.get();
			return row ? toSettings(row) : DEFAULT_DAILY_DIGEST_SETTINGS;
		},
		save(userId, settings, now) {
			const values = { ...settings, updatedAt: now };
			db.insert(dailyDigestSettings)
				.values({ userId, ...values })
				.onConflictDoUpdate({ target: dailyDigestSettings.userId, set: values })
				.run();
		},
		listRecipients() {
			return (
				db
					.select({ link: discordLinks, settings: dailyDigestSettings })
					.from(discordLinks)
					.leftJoin(dailyDigestSettings, eq(dailyDigestSettings.userId, discordLinks.userId))
					.all()
					// 送り先 (スレッドか DM) が今は無い人には送れないので、省く。両方あれば、スレッドを優先する (設計書 14.9)
					.flatMap(({ link, settings }) => {
						const channelId = link.threadChannelId ?? link.dmChannelId;
						return channelId === null
							? []
							: [
									{
										userId: link.userId,
										channelId,
										settings: settings ? toSettings(settings) : DEFAULT_DAILY_DIGEST_SETTINGS,
										lastSentFor: settings?.lastSentFor ?? null,
									},
								];
					})
			);
		},
		markSent(userId, date, now) {
			db.insert(dailyDigestSettings)
				.values({ userId, ...DEFAULT_DAILY_DIGEST_SETTINGS, lastSentFor: date, updatedAt: now })
				.onConflictDoUpdate({
					target: dailyDigestSettings.userId,
					set: { lastSentFor: date, updatedAt: now },
				})
				.run();
		},
	};
}
