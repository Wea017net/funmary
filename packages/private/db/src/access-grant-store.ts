// 予定や科目を、特定のメールアドレスの人にだけ見せる (限定公開、メールアドレスでの指定)。
// メールアドレスが実在する利用者のものかどうかは確かめない (存在するかしないかを教えないため)。
// 見る側の判断は、ログインのメールアドレスと照らし合わせて行う (findByEmail)
import { and, eq } from 'drizzle-orm';
import type { Database } from './database.ts';
import { accessGrants } from './schema.ts';

export type GrantResourceType = 'event' | 'subject';

export interface AccessGrant {
	readonly resourceType: GrantResourceType;
	readonly resourceId: number;
	readonly granteeEmail: string;
	readonly createdAt: Date;
}

export interface AccessGrantStore {
	/** 招待する。同じ組が既にあれば、何もしない (重ねて呼んでもよい) */
	grant(resourceType: GrantResourceType, resourceId: number, email: string, now: Date): void;
	/** 招待を外す。あれば true */
	revoke(resourceType: GrantResourceType, resourceId: number, email: string): boolean;
	/** その対象に招待されているメールアドレスの一覧 (持ち主が確かめる用) */
	list(resourceType: GrantResourceType, resourceId: number): AccessGrant[];
	/** そのメールアドレスに、その対象への招待があるか */
	isGranted(resourceType: GrantResourceType, resourceId: number, email: string): boolean;
	/** 対象を消したときに、まとめて招待も消す */
	revokeAll(resourceType: GrantResourceType, resourceId: number): void;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function createAccessGrantStore(database: Database): AccessGrantStore {
	const { db } = database;
	const match = (resourceType: GrantResourceType, resourceId: number, email: string) =>
		and(
			eq(accessGrants.resourceType, resourceType),
			eq(accessGrants.resourceId, resourceId),
			eq(accessGrants.granteeEmail, normalizeEmail(email)),
		);

	return {
		grant(resourceType, resourceId, email, now) {
			db.insert(accessGrants)
				.values({ resourceType, resourceId, granteeEmail: normalizeEmail(email), createdAt: now })
				.onConflictDoNothing()
				.run();
		},
		revoke(resourceType, resourceId, email) {
			return (
				db
					.delete(accessGrants)
					.where(match(resourceType, resourceId, email))
					.run().changes > 0
			);
		},
		list(resourceType, resourceId) {
			return db
				.select()
				.from(accessGrants)
				.where(
					and(eq(accessGrants.resourceType, resourceType), eq(accessGrants.resourceId, resourceId)),
				)
				.orderBy(accessGrants.createdAt)
				.all();
		},
		isGranted(resourceType, resourceId, email) {
			return (
				db
					.select()
					.from(accessGrants)
					.where(match(resourceType, resourceId, email))
					.get() !== undefined
			);
		},
		revokeAll(resourceType, resourceId) {
			db.delete(accessGrants)
				.where(
					and(eq(accessGrants.resourceType, resourceType), eq(accessGrants.resourceId, resourceId)),
				)
				.run();
		},
	};
}
