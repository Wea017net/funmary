import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from './database.ts';
import { createUnmatchedLessonStore } from './unmatched-lesson-store.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-unmatched-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const T0 = new Date('2026-09-27T00:00:00Z');
const T1 = new Date('2026-10-01T00:00:00Z');

describe('UnmatchedLessonStore', () => {
	it('照合できなかった授業名を、年度ごとに記録し、初めて見た時刻を残す', () => {
		const store = createUnmatchedLessonStore(database);
		expect(store.record(2026, ['架空の授業A', '架空の授業B'], T0)).toBe(2);
		expect(store.record(2026, ['架空の授業A'], T1)).toBe(0);
		expect(store.listUnresolved(2026)).toEqual([
			{ lessonName: '架空の授業A', firstSeenAt: T0, lastSeenAt: T1 },
			{ lessonName: '架空の授業B', firstSeenAt: T0, lastSeenAt: T0 },
		]);
	});

	it('年度が違えば、別に記録する', () => {
		const store = createUnmatchedLessonStore(database);
		store.record(2026, ['架空の授業A'], T0);
		store.record(2027, ['架空の授業A'], T1);
		expect(store.listUnresolved(2026)).toHaveLength(1);
		expect(store.listUnresolved(2027)).toEqual([
			{ lessonName: '架空の授業A', firstSeenAt: T1, lastSeenAt: T1 },
		]);
	});

	it('管理者が科目に紐付けたものは、未解決の一覧に出さない', () => {
		const store = createUnmatchedLessonStore(database);
		store.record(2026, ['架空の授業A'], T0);
		database.sqlite
			.prepare(
				"INSERT INTO subjects (academic_year, syllabus_id, name, term, updated_at) VALUES (2026, '1', '架空', 'fall', 0)",
			)
			.run();
		database.sqlite.prepare('UPDATE unmatched_lessons SET resolved_subject_id = 1').run();
		expect(store.listUnresolved(2026)).toEqual([]);
	});
});
