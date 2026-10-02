import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthStore } from './auth-store.ts';
import { openDatabase, type Database } from './database.ts';
import { createNotificationStore } from './notification-store.ts';
import { classChanges, courseRegistrations, subjects } from './schema.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-notifications-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const at = (iso: string) => new Date(iso);

function newUser(sub: string) {
	return createAuthStore(database).createUser(
		{ googleSub: sub, email: `${sub}@fun.ac.jp`, name: null, role: 'user' },
		at('2026-09-01T00:00:00Z'),
	);
}

const entry = (userId: string, overrides: Record<string, unknown> = {}) => ({
	userId,
	kind: 'cancellation' as const,
	title: '[休講] 情報処理演習 (10/3 2 限)',
	body: null,
	link: '/app/subjects/2026/100201',
	subjectId: null,
	dedupeKey: 'class-change:1',
	...overrides,
});

describe('通知欄', () => {
	it('足した通知を、新しい順に返す。同じ鍵の通知は、同じ人には二重に足さない', () => {
		const store = createNotificationStore(database);
		const user = newUser('a');
		expect(store.insertMany([entry(user)], at('2026-10-01T00:00:00Z'))).toHaveLength(1);
		expect(store.insertMany([entry(user)], at('2026-10-01T01:00:00Z'))).toHaveLength(0);
		store.insertMany(
			[entry(user, { kind: 'makeup', title: '[補講] B', dedupeKey: 'class-change:2' })],
			at('2026-10-02T00:00:00Z'),
		);
		const list = store.list(user, { limit: 10 });
		expect(list.map((item) => item.title)).toEqual(['[補講] B', '[休講] 情報処理演習 (10/3 2 限)']);
		expect(store.list(user, { limit: 10, kind: 'makeup' })).toHaveLength(1);
		// ほかの人の通知は見えない
		expect(store.list(newUser('b'), { limit: 10 })).toEqual([]);
	});

	it('未読を数え、1 件ずつ、またはまとめて既読にする。ほかの人の通知は既読にできない', () => {
		const store = createNotificationStore(database);
		const user = newUser('a');
		const other = newUser('b');
		const [first] = store.insertMany(
			[entry(user), entry(user, { dedupeKey: 'class-change:2' })],
			at('2026-10-01T00:00:00Z'),
		);
		expect(store.unreadCount(user)).toBe(2);
		expect(store.markRead(other, first!, at('2026-10-02T00:00:00Z'))).toBeNull();
		expect(store.markRead(user, first!, at('2026-10-02T00:00:00Z'))?.link).toBe(
			'/app/subjects/2026/100201',
		);
		expect(store.unreadCount(user)).toBe(1);
		expect(store.markAllRead(user, at('2026-10-02T00:00:00Z'))).toBe(1);
		expect(store.unreadCount(user)).toBe(0);
	});

	it('指定した時刻より古い通知を消す', () => {
		const store = createNotificationStore(database);
		const user = newUser('a');
		store.insertMany([entry(user)], at('2026-06-01T00:00:00Z'));
		store.insertMany([entry(user, { dedupeKey: 'x' })], at('2026-10-01T00:00:00Z'));
		expect(store.pruneBefore(at('2026-07-03T00:00:00Z'))).toBe(1);
		expect(store.list(user, { limit: 10 })).toHaveLength(1);
	});
});

describe('休講などの通知の候補', () => {
	it('履修している人ごとに、今日以降の休講などを返す。履修より前に見つけたものと、取り消されたものは除く', () => {
		const user = newUser('a');
		const late = newUser('late');
		const { db } = database;
		const subjectId = db
			.insert(subjects)
			.values({
				academicYear: 2026,
				syllabusId: '100201',
				name: '情報処理演習',
				term: 'fall',
				updatedAt: at('2026-09-01T00:00:00Z'),
			})
			.returning({ id: subjects.id })
			.get().id;
		db.insert(courseRegistrations)
			.values([
				{ userId: user, subjectId, createdAt: at('2026-09-01T00:00:00Z') },
				{ userId: late, subjectId, createdAt: at('2026-10-02T00:00:00Z') },
			])
			.run();
		const change = (overrides: Partial<typeof classChanges.$inferInsert>) =>
			db
				.insert(classChanges)
				.values({
					kind: 'cancellation',
					subjectId,
					lessonName: '情報処理演習',
					date: '2026-10-03',
					period: 2,
					firstSeenAt: at('2026-10-01T00:00:00Z'),
					lastSeenAt: at('2026-10-01T00:00:00Z'),
					...overrides,
				})
				.returning({ id: classChanges.id })
				.get().id;
		const upcoming = change({});
		change({ date: '2026-09-30', period: 1 });
		change({ period: 3, withdrawnAt: at('2026-10-01T06:00:00Z') });
		change({ subjectId: null, lessonName: '照合前', period: 4 });

		const candidates = createNotificationStore(database).classChangeCandidates('2026-10-01');
		expect(candidates).toEqual([
			{
				userId: user,
				classChangeId: upcoming,
				kind: 'cancellation',
				date: '2026-10-03',
				period: 2,
				room: null,
				fromRoom: null,
				subjectId,
				subjectName: '情報処理演習',
				academicYear: 2026,
				syllabusId: '100201',
			},
		]);
	});
});
