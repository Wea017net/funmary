// 管理者が用意するテストアカウント。大学のアカウントでない Google のアカウントでも、ログインして試せるようにする。
// 管理者ごとに持ち、利用者のデータは引き継がない。必要なときだけ、管理者の履修科目、曜日と時限、予定を写す。
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './database.ts';
import {
	courseRegistrations,
	personalTimetableSlots,
	testAccounts,
	userEvents,
	users,
} from './schema.ts';

/** 管理者 1 人が持てる数。この口で、ログインできるアカウントが際限なく増えないようにする */
export const MAX_TEST_ACCOUNTS_PER_ADMIN = 5;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface TestAccount {
	readonly id: number;
	readonly email: string;
	readonly createdAt: Date;
	/** ログインして、利用者として登録されているか */
	readonly userId: string | null;
	readonly lastLoginAt: Date | null;
}

export type AddTestAccountResult =
	| { readonly kind: 'added' }
	| { readonly kind: 'invalid' }
	/** 許可したドメイン (大学) のメールアドレスは、ふつうに登録できるので足さない */
	| { readonly kind: 'university' }
	/** すでに利用者か、ほかのテストアカウントにある */
	| { readonly kind: 'taken' }
	| { readonly kind: 'limit' };

export interface TestAccountStore {
	/** このメールアドレスが、テストアカウントとして用意されているか。ログインの判断が使う */
	isTestAccount(email: string): boolean;
	list(ownerId: string): TestAccount[];
	add(
		ownerId: string,
		email: string,
		options: { readonly universityDomains: readonly string[] },
		now: Date,
	): AddTestAccountResult;
	/** 管理者のテストアカウントを消す。ログイン済みなら、その利用者 (と持ち物) も消す。消したら true */
	remove(ownerId: string, id: number): boolean;
	/**
	 * テストアカウントのデータを、管理者のもので置き換える。履修科目、曜日と時限の書き換え、予定を写す
	 * (予定は非公開にする)。まだログインしていないテストアカウントなら false
	 */
	copyFromOwner(ownerId: string, id: number, now: Date): boolean;
}

export function createTestAccountStore(database: Database): TestAccountStore {
	const { db, sqlite } = database;

	const isRegistered = (email: string) =>
		db
			.select({ id: testAccounts.id })
			.from(testAccounts)
			.where(eq(testAccounts.email, email))
			.get() !== undefined;
	const find = (ownerId: string, id: number) =>
		db
			.select()
			.from(testAccounts)
			.where(and(eq(testAccounts.id, id), eq(testAccounts.ownerId, ownerId)))
			.get();
	const userOf = (email: string) =>
		db
			.select()
			.from(users)
			.where(sql`lower(${users.email}) = ${email}`)
			.get();

	return {
		isTestAccount(email) {
			return isRegistered(email.trim().toLowerCase());
		},
		list(ownerId) {
			return db
				.select()
				.from(testAccounts)
				.where(eq(testAccounts.ownerId, ownerId))
				.orderBy(testAccounts.id)
				.all()
				.map((row) => {
					const user = userOf(row.email);
					return {
						id: row.id,
						email: row.email,
						createdAt: row.createdAt,
						userId: user?.id ?? null,
						lastLoginAt: user?.lastLoginAt ?? null,
					};
				});
		},
		add(ownerId, rawEmail, { universityDomains }, now) {
			const email = rawEmail.trim().toLowerCase();
			if (!EMAIL.test(email) || email.length > 254) return { kind: 'invalid' };
			const domain = email.slice(email.lastIndexOf('@') + 1);
			if (universityDomains.some((allowed) => allowed.toLowerCase() === domain)) {
				return { kind: 'university' };
			}
			return sqlite.transaction((): AddTestAccountResult => {
				const count = db
					.select({ id: testAccounts.id })
					.from(testAccounts)
					.where(eq(testAccounts.ownerId, ownerId))
					.all().length;
				if (count >= MAX_TEST_ACCOUNTS_PER_ADMIN) return { kind: 'limit' };
				if (userOf(email) || isRegistered(email)) return { kind: 'taken' };
				db.insert(testAccounts).values({ ownerId, email, createdAt: now }).run();
				return { kind: 'added' };
			})();
		},
		remove(ownerId, id) {
			return sqlite.transaction(() => {
				const account = find(ownerId, id);
				if (!account) return false;
				const user = userOf(account.email);
				if (user) db.delete(users).where(eq(users.id, user.id)).run();
				db.delete(testAccounts).where(eq(testAccounts.id, id)).run();
				return true;
			})();
		},
		copyFromOwner(ownerId, id, now) {
			return sqlite.transaction(() => {
				const account = find(ownerId, id);
				const target = account && userOf(account.email);
				if (!target) return false;
				db.delete(courseRegistrations).where(eq(courseRegistrations.userId, target.id)).run();
				db.delete(personalTimetableSlots).where(eq(personalTimetableSlots.userId, target.id)).run();
				db.delete(userEvents).where(eq(userEvents.ownerId, target.id)).run();

				for (const row of db
					.select()
					.from(courseRegistrations)
					.where(eq(courseRegistrations.userId, ownerId))
					.all()) {
					db.insert(courseRegistrations)
						.values({ ...row, userId: target.id, createdAt: now })
						.run();
				}
				for (const row of db
					.select()
					.from(personalTimetableSlots)
					.where(eq(personalTimetableSlots.userId, ownerId))
					.all()) {
					db.insert(personalTimetableSlots)
						.values({
							userId: target.id,
							subjectId: row.subjectId,
							weekday: row.weekday,
							period: row.period,
							room: row.room,
							updatedAt: now,
						})
						.run();
				}
				for (const row of db
					.select()
					.from(userEvents)
					.where(eq(userEvents.ownerId, ownerId))
					.all()) {
					db.insert(userEvents)
						.values({
							ownerId: target.id,
							title: row.title,
							location: row.location,
							notes: row.notes,
							startDate: row.startDate,
							endDate: row.endDate,
							timeKind: row.timeKind,
							startTime: row.startTime,
							endTime: row.endTime,
							startPeriod: row.startPeriod,
							endPeriod: row.endPeriod,
							rrule: row.rrule,
							excludedDates: row.excludedDates,
							visibility: 'private',
							shareToken: null,
							createdAt: now,
							updatedAt: now,
						})
						.run();
				}
				return true;
			})();
		},
	};
}
