// ICS とフィードの URL のトークン。利用者ごと、種類ごとに有効なものは 1 つだけにする。
// トークンは発行したときに 1 回だけ返し、DB には SHA-256 だけを保存する。
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { Database } from './database.ts';
import { feedTokens, users } from './schema.ts';
import { generateToken, hashToken } from './secrets.ts';

export type FeedTokenKind = 'calendar' | 'feed';

/** 使った日時を書き込む間隔。取りに来るたびに書き込まないようにする */
const MARK_USED_INTERVAL_MS = 60 * 60 * 1000;

/** 載せる予定や通知の種類など、トークンごとの追加の設定。中身はトークンの種類ごとに決める */
export type FeedTokenOptions = Record<string, unknown>;

export interface FeedTokenStore {
	/** 新しいトークンを発行して返す。同じ種類の前のトークンは使えなくなる */
	issue(userId: string, kind: FeedTokenKind, now: Date): string;
	/** 有効なトークンの持ち主。取り消し済み、知らないトークン、停止した利用者なら null */
	findOwner(
		kind: FeedTokenKind,
		token: string,
	): { id: number; userId: string; options: FeedTokenOptions | null } | null;
	/** 前に書き込んでから 1 時間以上たっていれば、使った日時を書き込む */
	markUsed(id: number, now: Date): void;
	/** 有効なトークンの発行日時、最後に使った日時、追加の設定。なければ null */
	current(
		userId: string,
		kind: FeedTokenKind,
	): { createdAt: Date; lastUsedAt: Date | null; options: FeedTokenOptions | null } | null;
	/** 有効なトークンを取り消す。取り消したものがあれば true */
	revoke(userId: string, kind: FeedTokenKind, now: Date): boolean;
	/** 有効なトークンの追加の設定を変える。変えたものがあれば true */
	setOptions(userId: string, kind: FeedTokenKind, options: FeedTokenOptions | null): boolean;
}

export function createFeedTokenStore(database: Database): FeedTokenStore {
	const { db } = database;
	const active = (userId: string, kind: FeedTokenKind) =>
		and(eq(feedTokens.userId, userId), eq(feedTokens.kind, kind), isNull(feedTokens.revokedAt));
	const revokeActive = (userId: string, kind: FeedTokenKind, now: Date) =>
		db.update(feedTokens).set({ revokedAt: now }).where(active(userId, kind)).run().changes;

	return {
		issue(userId, kind, now) {
			const token = generateToken();
			db.transaction(() => {
				revokeActive(userId, kind, now);
				db.insert(feedTokens)
					.values({ userId, kind, tokenHash: hashToken(token), createdAt: now })
					.run();
			});
			return token;
		},
		findOwner(kind, token) {
			const row = db
				.select({ id: feedTokens.id, userId: feedTokens.userId, options: feedTokens.options })
				.from(feedTokens)
				.innerJoin(users, eq(users.id, feedTokens.userId))
				.where(
					and(
						eq(feedTokens.tokenHash, hashToken(token)),
						eq(feedTokens.kind, kind),
						isNull(feedTokens.revokedAt),
						eq(users.status, 'active'),
					),
				)
				.get();
			return row ?? null;
		},
		markUsed(id, now) {
			const threshold = new Date(now.getTime() - MARK_USED_INTERVAL_MS);
			db.update(feedTokens)
				.set({ lastUsedAt: now })
				.where(
					and(
						eq(feedTokens.id, id),
						or(isNull(feedTokens.lastUsedAt), lt(feedTokens.lastUsedAt, threshold)),
					),
				)
				.run();
		},
		current(userId, kind) {
			const row = db
				.select({
					createdAt: feedTokens.createdAt,
					lastUsedAt: feedTokens.lastUsedAt,
					options: feedTokens.options,
				})
				.from(feedTokens)
				.where(active(userId, kind))
				.get();
			return row ?? null;
		},
		revoke(userId, kind, now) {
			return revokeActive(userId, kind, now) > 0;
		},
		setOptions(userId, kind, options) {
			return db.update(feedTokens).set({ options }).where(active(userId, kind)).run().changes > 0;
		},
	};
}
