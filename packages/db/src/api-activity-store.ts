// アクセストークンからの書き込みの履歴。利用者が、設定の画面で、どのクライアントが何をしたかを確かめる。
import { desc, eq, sql } from 'drizzle-orm';
import type { Database } from './database.ts';
import { apiActivity } from './schema.ts';

/** 1 人につき残す件数。これを超えたら、古いものから消す */
export const API_ACTIVITY_LIMIT = 200;

export type ApiActivityAction =
	'event.create' | 'event.update' | 'event.delete' | 'notification.read' | 'notification.readAll';

export interface ApiActivityInput {
	readonly userId: string;
	/** 取り消されたあとの記録のために、null も許す */
	readonly tokenId: number | null;
	readonly tokenName: string;
	readonly action: ApiActivityAction;
	readonly targetId: number | null;
	readonly summary: string;
}

export interface ApiActivityRecord {
	readonly id: number;
	readonly tokenId: number | null;
	readonly tokenName: string;
	readonly action: ApiActivityAction;
	readonly targetId: number | null;
	readonly summary: string;
	readonly createdAt: Date;
}

export interface ApiActivityStore {
	/** 履歴に足す。その人の件数が上限を超えたら、古いものを消す */
	record(input: ApiActivityInput, now: Date): void;
	/** 新しい順 */
	listRecent(userId: string, limit?: number): readonly ApiActivityRecord[];
}

export function createApiActivityStore(database: Database): ApiActivityStore {
	const { db, sqlite } = database;
	return {
		record(input, now) {
			sqlite.transaction(() => {
				db.insert(apiActivity)
					.values({
						userId: input.userId,
						tokenId: input.tokenId,
						tokenName: input.tokenName,
						action: input.action,
						targetId: input.targetId,
						summary: input.summary,
						createdAt: now,
					})
					.run();
				db.delete(apiActivity)
					.where(
						sql`${apiActivity.userId} = ${input.userId} AND ${apiActivity.id} NOT IN (
							SELECT id FROM api_activity WHERE user_id = ${input.userId} ORDER BY id DESC LIMIT ${API_ACTIVITY_LIMIT}
						)`,
					)
					.run();
			})();
		},
		listRecent(userId, limit = 50) {
			return db
				.select({
					id: apiActivity.id,
					tokenId: apiActivity.tokenId,
					tokenName: apiActivity.tokenName,
					action: apiActivity.action,
					targetId: apiActivity.targetId,
					summary: apiActivity.summary,
					createdAt: apiActivity.createdAt,
				})
				.from(apiActivity)
				.where(eq(apiActivity.userId, userId))
				.orderBy(desc(apiActivity.id))
				.limit(limit)
				.all() as ApiActivityRecord[];
		},
	};
}
