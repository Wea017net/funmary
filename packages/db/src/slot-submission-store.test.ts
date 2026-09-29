import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthStore } from './auth-store.ts';
import { openDatabase, type Database } from './database.ts';
import { createSlotSubmissionStore } from './slot-submission-store.ts';
import { createSubjectStore } from './subject-store.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-slot-submissions-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const at = (iso: string) => new Date(iso);

function setup() {
	const auth = createAuthStore(database);
	const userId = auth.createUser(
		{ googleSub: 'u', email: 'u@fun.ac.jp', name: null, role: 'user' },
		at('2026-01-01T00:00:00Z'),
	);
	const adminId = auth.createUser(
		{ googleSub: 'a', email: 'a@fun.ac.jp', name: null, role: 'admin' },
		at('2026-01-01T00:00:00Z'),
	);
	const subjectId = createSubjectStore(database).createUserSubject(
		{ academicYear: 2026, name: 'キャリアガイダンス', term: 'fall', teacher: null },
		userId,
		at('2026-01-01T00:00:00Z'),
	);
	return { userId, adminId, subjectId };
}

describe('createSlotSubmissionStore', () => {
	it('提出すると確認待ちに出て、新しい順に並ぶ', () => {
		const store = createSlotSubmissionStore(database);
		const { userId, subjectId } = setup();
		store.submit(
			{ subjectId, weekday: 2, period: 3, room: '363' },
			userId,
			at('2026-10-01T00:00:00Z'),
		);
		store.submit(
			{ subjectId, weekday: 3, period: 1, room: null },
			userId,
			at('2026-10-02T00:00:00Z'),
		);
		expect(store.listPending()).toMatchObject([
			{ subjectName: 'キャリアガイダンス', weekday: 3, period: 1, submittedByEmail: 'u@fun.ac.jp' },
			{ subjectName: 'キャリアガイダンス', weekday: 2, period: 3, submittedByEmail: 'u@fun.ac.jp' },
		]);
	});

	it('承認、または却下すると、確認待ちから消える。二重には決められない', () => {
		const store = createSlotSubmissionStore(database);
		const { userId, adminId, subjectId } = setup();
		const id = store.submit(
			{ subjectId, weekday: 2, period: 3, room: '363' },
			userId,
			at('2026-10-01T00:00:00Z'),
		);
		expect(store.decide(id, 'approved', adminId, at('2026-10-02T00:00:00Z'))).toBe(true);
		expect(store.listPending()).toEqual([]);
		expect(store.decide(id, 'approved', adminId, at('2026-10-03T00:00:00Z'))).toBe(false);
	});

	it('無い ID を決めようとすると false', () => {
		const store = createSlotSubmissionStore(database);
		const { adminId } = setup();
		expect(store.decide(9999, 'rejected', adminId, at('2026-10-01T00:00:00Z'))).toBe(false);
	});

	it('find で、曜日、時限、教室を取り出せる', () => {
		const store = createSlotSubmissionStore(database);
		const { userId, subjectId } = setup();
		const id = store.submit(
			{ subjectId, weekday: 2, period: 3, room: '363' },
			userId,
			at('2026-10-01T00:00:00Z'),
		);
		expect(store.find(id)).toEqual({ subjectId, weekday: 2, period: 3, room: '363' });
		expect(store.find(9999)).toBeNull();
	});
});
