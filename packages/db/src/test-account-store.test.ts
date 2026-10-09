import { describe, expect, it } from 'vitest';
import { createAuthStore } from './auth-store.ts';
import { createCourseStore } from './course-store.ts';
import type { Database } from './database.ts';
import { createSubjectStore } from './subject-store.ts';
import { createTestAccountStore, MAX_TEST_ACCOUNTS_PER_ADMIN } from './test-account-store.ts';
import { useTestDatabase } from './testing.ts';
import { createUserEventStore } from './user-event-store.ts';

let database: Database;
useTestDatabase('funmary-test-accounts-', (db) => (database = db));

const T0 = new Date('2026-10-01T00:00:00Z');
const OPTIONS = { universityDomains: ['fun.ac.jp'] };

function newUser(email: string) {
	return createAuthStore(database).createUser(
		{ googleSub: email, email, name: null, role: 'user' },
		T0,
	);
}

describe('テストアカウント', () => {
	it('メールアドレスを足すと、小文字にそろえて覚え、テストアカウントとして引ける', () => {
		const admin = newUser('admin@fun.ac.jp');
		const store = createTestAccountStore(database);

		expect(store.add(admin, '  Tester@Example.com ', OPTIONS, T0)).toEqual({ kind: 'added' });

		expect(store.isTestAccount('tester@example.com')).toBe(true);
		expect(store.isTestAccount('TESTER@example.com')).toBe(true);
		expect(store.isTestAccount('other@example.com')).toBe(false);
		expect(store.list(admin)).toMatchObject([{ email: 'tester@example.com', userId: null }]);
	});

	it('形が違うもの、大学のドメイン、すでにあるもの、上限を超えるものは足さない', () => {
		const admin = newUser('admin@fun.ac.jp');
		const other = newUser('other@fun.ac.jp');
		newUser('taken@example.com');
		const store = createTestAccountStore(database);

		expect(store.add(admin, 'not-an-email', OPTIONS, T0)).toEqual({ kind: 'invalid' });
		expect(store.add(admin, 'someone@FUN.ac.jp', OPTIONS, T0)).toEqual({ kind: 'university' });
		expect(store.add(admin, 'taken@example.com', OPTIONS, T0)).toEqual({ kind: 'taken' });
		store.add(admin, 'a@example.com', OPTIONS, T0);
		expect(store.add(other, 'a@example.com', OPTIONS, T0)).toEqual({ kind: 'taken' });
		for (let i = 1; i < MAX_TEST_ACCOUNTS_PER_ADMIN; i++) {
			expect(store.add(admin, `t${i}@example.com`, OPTIONS, T0)).toEqual({ kind: 'added' });
		}
		expect(store.add(admin, 'extra@example.com', OPTIONS, T0)).toEqual({ kind: 'limit' });
	});

	it('管理者ごとに持つ。ほかの管理者のものは見えず、消せない', () => {
		const a = newUser('a@fun.ac.jp');
		const b = newUser('b@fun.ac.jp');
		const store = createTestAccountStore(database);
		store.add(a, 'a-test@example.com', OPTIONS, T0);
		const [entry] = store.list(a);

		expect(store.list(b)).toEqual([]);
		expect(store.remove(b, entry!.id)).toBe(false);
		expect(store.isTestAccount('a-test@example.com')).toBe(true);
	});

	it('消すと、ログイン済みの利用者と持ち物も消える', () => {
		const admin = newUser('admin@fun.ac.jp');
		const store = createTestAccountStore(database);
		store.add(admin, 'tester@example.com', OPTIONS, T0);
		const tester = newUser('tester@example.com');
		const [entry] = store.list(admin);
		expect(entry?.userId).toBe(tester);

		expect(store.remove(admin, entry!.id)).toBe(true);

		expect(createAuthStore(database).findUserById(tester)).toBeNull();
		expect(store.isTestAccount('tester@example.com')).toBe(false);
	});

	it('管理者のデータを写すと、テストアカウントのデータが置き換わる。予定は非公開にする', () => {
		const admin = newUser('admin@fun.ac.jp');
		const subjectId = createSubjectStore(database).upsert(
			{
				academicYear: 2026,
				syllabusId: '100001',
				name: '架空の代数',
				teacher: null,
				credits: 2,
				term: 'fall',
				attributes: {},
				syllabus: {},
				syllabusUrl: null,
			},
			T0,
		);
		const courses = createCourseStore(database);
		courses.register(admin, subjectId, T0);
		const events = createUserEventStore(database);
		const event = {
			title: '管理者の予定',
			location: null,
			notes: 'メモ',
			startDate: '2026-10-05',
			endDate: '2026-10-05',
			time: { kind: 'allDay' as const },
			rrule: null,
			excludedDates: [],
			visibility: 'public' as const,
		};
		events.create(admin, event, T0);
		const store = createTestAccountStore(database);
		store.add(admin, 'tester@example.com', OPTIONS, T0);
		const tester = newUser('tester@example.com');
		events.create(tester, { ...event, title: '前からあった予定' }, T0);

		expect(store.copyFromOwner(admin, store.list(admin)[0]!.id, T0)).toBe(true);

		expect(courses.listRegistrations(tester)).toHaveLength(1);
		expect(events.listByOwner(tester)).toMatchObject([
			{ title: '管理者の予定', visibility: 'private', shareToken: null },
		]);
		// 管理者のデータは、そのまま
		expect(events.listByOwner(admin)).toMatchObject([{ visibility: 'public' }]);
	});

	it('まだログインしていないテストアカウントには、写せない', () => {
		const admin = newUser('admin@fun.ac.jp');
		const store = createTestAccountStore(database);
		store.add(admin, 'tester@example.com', OPTIONS, T0);

		expect(store.copyFromOwner(admin, store.list(admin)[0]!.id, T0)).toBe(false);
	});
});
