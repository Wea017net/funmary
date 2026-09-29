import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthStore } from './auth-store.ts';
import { openDatabase, type Database } from './database.ts';
import { createPersonalSlotStore } from './personal-slot-store.ts';
import { createSubjectStore } from './subject-store.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-personal-slots-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const at = (iso: string) => new Date(iso);

function setup() {
	const userId = createAuthStore(database).createUser(
		{ googleSub: 'u', email: 'u@fun.ac.jp', name: null, role: 'user' },
		at('2026-01-01T00:00:00Z'),
	);
	const subjectId = createSubjectStore(database).createUserSubject(
		{ academicYear: 2026, name: 'キャリアガイダンス', term: 'fall', teacher: null },
		userId,
		at('2026-01-01T00:00:00Z'),
	);
	return { userId, subjectId };
}

describe('createPersonalSlotStore', () => {
	it('足した枠が、その利用者とその科目だけに出る', () => {
		const store = createPersonalSlotStore(database);
		const { userId, subjectId } = setup();
		store.set(
			userId,
			subjectId,
			{ weekday: 2, period: 3, room: '363' },
			at('2026-10-01T00:00:00Z'),
		);

		expect(store.listForSubject(userId, subjectId)).toEqual([
			{ weekday: 2, period: 3, room: '363' },
		]);
		expect(store.listForSubject('別の利用者', subjectId)).toEqual([]);
	});

	it('同じ曜日と時限に足すと、教室を上書きする', () => {
		const store = createPersonalSlotStore(database);
		const { userId, subjectId } = setup();
		store.set(
			userId,
			subjectId,
			{ weekday: 2, period: 3, room: '363' },
			at('2026-10-01T00:00:00Z'),
		);
		store.set(
			userId,
			subjectId,
			{ weekday: 2, period: 3, room: '364' },
			at('2026-10-02T00:00:00Z'),
		);

		expect(store.listForSubject(userId, subjectId)).toEqual([
			{ weekday: 2, period: 3, room: '364' },
		]);
	});

	it('消すと一覧から外れる。無いものを消しても false', () => {
		const store = createPersonalSlotStore(database);
		const { userId, subjectId } = setup();
		store.set(userId, subjectId, { weekday: 2, period: 3, room: null }, at('2026-10-01T00:00:00Z'));

		expect(store.remove(userId, subjectId, 2, 3)).toBe(true);
		expect(store.listForSubject(userId, subjectId)).toEqual([]);
		expect(store.remove(userId, subjectId, 2, 3)).toBe(false);
	});
});
