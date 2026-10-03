// 利用者の Discord アカウントと Funmary のアカウントの紐付け (設計書 14.9)。
// トークンは SecretBox で暗号化して保存し、読み出すときだけ復号する。
// 本人だけのスレッドと DM は、両方を同時に持てる (通知の種類ごとに送り先を振り分けられるようにするため、#163)
import { eq } from 'drizzle-orm';
import type { Database } from './database.ts';
import type { NotificationKind } from './notification-store.ts';
import { discordLinks } from './schema.ts';
import type { SecretBox } from './secrets.ts';

/** 1 つの送り先 (thread か dm)。both は、スレッドと DM の両方に送る */
export type DiscordDestination = 'thread' | 'dm' | 'both';

export interface DiscordLinkKindSetting {
	readonly destination: DiscordDestination;
	readonly mention: boolean;
}

/** 設定していない種類は、スレッド、メンション無しとみなす */
export const DEFAULT_KIND_SETTING: DiscordLinkKindSetting = {
	destination: 'thread',
	mention: false,
};

export type DiscordLinkKindSettings = Partial<Record<NotificationKind, DiscordLinkKindSetting>>;

export interface DiscordLinkInput {
	readonly discordUserId: string;
	readonly accessToken: string;
	readonly refreshToken: string;
	readonly tokenExpiresAt: Date;
	readonly threadChannelId: string | null;
	readonly dmChannelId: string | null;
	readonly kindSettings: DiscordLinkKindSettings;
}

export interface DiscordLink {
	readonly userId: string;
	readonly discordUserId: string;
	readonly accessToken: string;
	readonly refreshToken: string;
	readonly tokenExpiresAt: Date;
	/** 本人だけのスレッドの ID。用意していない、完全に削除したあとは null */
	readonly threadChannelId: string | null;
	/** DM チャンネルの ID。用意していない間は null */
	readonly dmChannelId: string | null;
	readonly kindSettings: DiscordLinkKindSettings;
	readonly createdAt: Date;
}

/** 保存された値を読む。形が違う種類や項目は無視する */
export function parseKindSettings(value: unknown): DiscordLinkKindSettings {
	if (typeof value !== 'object' || value === null) return {};
	const result: Record<string, DiscordLinkKindSetting> = {};
	for (const [kind, raw] of Object.entries(value as Record<string, unknown>)) {
		if (typeof raw !== 'object' || raw === null) continue;
		const { destination, mention } = raw as Record<string, unknown>;
		if (
			(destination === 'thread' || destination === 'dm' || destination === 'both') &&
			typeof mention === 'boolean'
		) {
			result[kind] = { destination, mention };
		}
	}
	return result;
}

/** その種類の設定。無ければ既定 (スレッド、メンション無し) */
export function kindSetting(
	settings: DiscordLinkKindSettings,
	kind: NotificationKind,
): DiscordLinkKindSetting {
	return settings[kind] ?? DEFAULT_KIND_SETTING;
}

export interface DiscordLinkStore {
	/** 紐付けを保存する。同じ利用者の前の紐付けがあれば置き換える */
	save(userId: string, input: DiscordLinkInput, now: Date): void;
	/** 利用者の紐付け。なければ null */
	findByUser(userId: string): DiscordLink | null;
	/** その Discord アカウントに、別の利用者が既に紐付いていれば true (乗っ取り防止) */
	isDiscordUserLinkedToOther(discordUserId: string, excludingUserId: string): boolean;
	/** 紐付けを消す。消せたものがあれば true */
	remove(userId: string): DiscordLink | null;
	/**
	 * スレッドか DM の、片方のチャンネル ID だけを変える。トークンや、もう片方には触れない。
	 * null を渡すと、そちらの送り先が無い状態にする (スレッドを削除したときなど)。連携していなければ false
	 */
	setChannel(userId: string, which: 'thread' | 'dm', channelId: string | null): boolean;
	/** 通知の種類ごとの送り先とメンションを、まとめて置き換える。連携していなければ false */
	setKindSettings(userId: string, settings: DiscordLinkKindSettings): boolean;
}

export function createDiscordLinkStore(database: Database, secretBox: SecretBox): DiscordLinkStore {
	const { db } = database;

	const toLink = (row: typeof discordLinks.$inferSelect): DiscordLink => ({
		userId: row.userId,
		discordUserId: row.discordUserId,
		accessToken: secretBox.decrypt(row.accessTokenEncrypted),
		refreshToken: secretBox.decrypt(row.refreshTokenEncrypted),
		tokenExpiresAt: row.tokenExpiresAt,
		threadChannelId: row.threadChannelId,
		dmChannelId: row.dmChannelId,
		kindSettings: parseKindSettings(row.kindSettings),
		createdAt: row.createdAt,
	});

	return {
		save(userId, input, now) {
			const values = {
				discordUserId: input.discordUserId,
				accessTokenEncrypted: secretBox.encrypt(input.accessToken),
				refreshTokenEncrypted: secretBox.encrypt(input.refreshToken),
				tokenExpiresAt: input.tokenExpiresAt,
				threadChannelId: input.threadChannelId,
				dmChannelId: input.dmChannelId,
				kindSettings: input.kindSettings,
				createdAt: now,
			};
			db.insert(discordLinks)
				.values({ userId, ...values })
				.onConflictDoUpdate({ target: discordLinks.userId, set: values })
				.run();
		},
		findByUser(userId) {
			const row = db.select().from(discordLinks).where(eq(discordLinks.userId, userId)).get();
			return row ? toLink(row) : null;
		},
		isDiscordUserLinkedToOther(discordUserId, excludingUserId) {
			const row = db
				.select({ userId: discordLinks.userId })
				.from(discordLinks)
				.where(eq(discordLinks.discordUserId, discordUserId))
				.get();
			return row !== undefined && row.userId !== excludingUserId;
		},
		remove(userId) {
			const row = db.select().from(discordLinks).where(eq(discordLinks.userId, userId)).get();
			if (!row) return null;
			db.delete(discordLinks).where(eq(discordLinks.userId, userId)).run();
			return toLink(row);
		},
		setChannel(userId, which, channelId) {
			const column =
				which === 'thread' ? { threadChannelId: channelId } : { dmChannelId: channelId };
			return (
				db.update(discordLinks).set(column).where(eq(discordLinks.userId, userId)).run().changes > 0
			);
		},
		setKindSettings(userId, settings) {
			return (
				db
					.update(discordLinks)
					.set({ kindSettings: settings })
					.where(eq(discordLinks.userId, userId))
					.run().changes > 0
			);
		},
	};
}
