// 利用者の Discord アカウントと Funmary のアカウントの紐付け (設計書 14.9)。
// トークンは SecretBox で暗号化して保存し、読み出すときだけ復号する。
import { eq } from 'drizzle-orm';
import type { Database } from './database.ts';
import { discordLinks } from './schema.ts';
import type { SecretBox } from './secrets.ts';

export type DiscordDestination = 'thread' | 'dm';

export interface DiscordLinkInput {
	readonly discordUserId: string;
	readonly accessToken: string;
	readonly refreshToken: string;
	readonly tokenExpiresAt: Date;
	readonly destination: DiscordDestination;
	/** destination が thread ならスレッドの ID、dm なら DM チャンネルの ID */
	readonly channelId: string;
}

export interface DiscordLink {
	readonly userId: string;
	readonly discordUserId: string;
	readonly accessToken: string;
	readonly refreshToken: string;
	readonly tokenExpiresAt: Date;
	readonly destination: DiscordDestination;
	readonly channelId: string;
	readonly createdAt: Date;
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
}

export function createDiscordLinkStore(database: Database, secretBox: SecretBox): DiscordLinkStore {
	const { db } = database;

	const toLink = (row: typeof discordLinks.$inferSelect): DiscordLink => ({
		userId: row.userId,
		discordUserId: row.discordUserId,
		accessToken: secretBox.decrypt(row.accessTokenEncrypted),
		refreshToken: secretBox.decrypt(row.refreshTokenEncrypted),
		tokenExpiresAt: row.tokenExpiresAt,
		destination: row.destination,
		channelId: row.channelId,
		createdAt: row.createdAt,
	});

	return {
		save(userId, input, now) {
			db.insert(discordLinks)
				.values({
					userId,
					discordUserId: input.discordUserId,
					accessTokenEncrypted: secretBox.encrypt(input.accessToken),
					refreshTokenEncrypted: secretBox.encrypt(input.refreshToken),
					tokenExpiresAt: input.tokenExpiresAt,
					destination: input.destination,
					channelId: input.channelId,
					createdAt: now,
				})
				.onConflictDoUpdate({
					target: discordLinks.userId,
					set: {
						discordUserId: input.discordUserId,
						accessTokenEncrypted: secretBox.encrypt(input.accessToken),
						refreshTokenEncrypted: secretBox.encrypt(input.refreshToken),
						tokenExpiresAt: input.tokenExpiresAt,
						destination: input.destination,
						channelId: input.channelId,
						createdAt: now,
					},
				})
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
	};
}
