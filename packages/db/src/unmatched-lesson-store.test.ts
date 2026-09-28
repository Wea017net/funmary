import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from './database.ts';
import { createSubjectStore } from './subject-store.ts';
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

describe('resolvedNames', () => {
	it('管理者が科目に紐付けた名前と科目の ID を、年度ごとに返す', () => {
		const subjectId = createSubjectStore(database).upsert(
			{
				academicYear: 2026,
				syllabusId: '100001',
				name: '架空の科目',
				teacher: null,
				credits: 2,
				term: 'fall',
				attributes: {},
				syllabus: {},
				syllabusUrl: null,
			},
			new Date(0),
		);
		const store = createUnmatchedLessonStore(database);
		store.record(2026, ['架空の科目 (再)', '未解決の名前'], new Date(0));
		store.record(2025, ['架空の科目 (再)'], new Date(0));
		database.sqlite
			.prepare(
				"UPDATE unmatched_lessons SET resolved_subject_id = ? WHERE lesson_name = '架空の科目 (再)'",
			)
			.run(subjectId);
		expect(store.resolvedNames(2026)).toEqual(new Map([['架空の科目 (再)', subjectId]]));
		expect(store.resolvedNames(2024)).toEqual(new Map());
	});
});

describe('resolve', () => {
	it('授業名を科目に紐付け、未解決の一覧から外す。記録のない名前なら false を返す', () => {
		const subjectId = createSubjectStore(database).upsert(
			{
				academicYear: 2026,
				syllabusId: '100001',
				name: '架空の科目',
				teacher: null,
				credits: 2,
				term: 'fall',
				attributes: {},
				syllabus: {},
				syllabusUrl: null,
			},
			T0,
		);
		const store = createUnmatchedLessonStore(database);
		store.record(2026, ['架空の科目 (再)', '別の名前'], T0);
		expect(store.resolve(2026, '架空の科目 (再)', subjectId)).toBe(true);
		expect(store.listUnresolved(2026).map((l) => l.lessonName)).toEqual(['別の名前']);
		expect(store.resolvedNames(2026)).toEqual(new Map([['架空の科目 (再)', subjectId]]));
		expect(store.resolve(2026, '記録のない名前', subjectId)).toBe(false);
	});
});

describe('ignore と restore', () => {
	it('科目にしない名前を、未解決の一覧から外し、あとで戻せる。記録のない名前なら false を返す', () => {
		const store = createUnmatchedLessonStore(database);
		store.record(2026, ['架空の集会', '架空の授業'], T0);
		expect(store.ignore(2026, '架空の集会', T1)).toBe(true);
		expect(store.listUnresolved(2026).map((l) => l.lessonName)).toEqual(['架空の授業']);
		expect(store.listIgnored(2026)).toEqual([
			{ lessonName: '架空の集会', firstSeenAt: T0, lastSeenAt: T0 },
		]);
		expect(store.ignore(2026, '記録のない名前', T1)).toBe(false);

		expect(store.restore(2026, '架空の集会')).toBe(true);
		expect(store.listIgnored(2026)).toEqual([]);
		expect(store.listUnresolved(2026).map((l) => l.lessonName)).toEqual([
			'架空の授業',
			'架空の集会',
		]);
	});

	it('科目にしない名前を再び記録しても、科目にしないままにする', () => {
		const store = createUnmatchedLessonStore(database);
		store.record(2026, ['架空の集会'], T0);
		store.ignore(2026, '架空の集会', T0);
		expect(store.record(2026, ['架空の集会'], T1)).toBe(0);
		expect(store.listIgnored(2026)).toHaveLength(1);
		expect(store.listUnresolved(2026)).toEqual([]);
	});

	it('紐付け済みの名前を科目にしないにすると、紐付けを外す', () => {
		const subjectId = insertSubject();
		const store = createUnmatchedLessonStore(database);
		store.record(2026, ['架空の授業'], T0);
		store.resolve(2026, '架空の授業', subjectId);
		store.ignore(2026, '架空の授業', T1);
		expect(store.resolvedNames(2026)).toEqual(new Map());
		expect(store.listIgnored(2026)).toHaveLength(1);
	});

	it('科目にしない名前を科目に紐付けると、科目にしないを解く', () => {
		const subjectId = insertSubject();
		const store = createUnmatchedLessonStore(database);
		store.record(2026, ['架空の授業'], T0);
		store.ignore(2026, '架空の授業', T0);
		store.resolve(2026, '架空の授業', subjectId);
		expect(store.listIgnored(2026)).toEqual([]);
		expect(store.resolvedNames(2026)).toEqual(new Map([['架空の授業', subjectId]]));
	});
});

describe('listResolved と unresolve', () => {
	it('紐付け済みの名前を、科目の ID とあわせて返し、紐付けを外すと未解決に戻す', () => {
		const subjectId = insertSubject();
		const store = createUnmatchedLessonStore(database);
		store.record(2026, ['架空の授業', '別の名前'], T0);
		store.resolve(2026, '架空の授業', subjectId);
		expect(store.listResolved(2026)).toEqual([
			{ lessonName: '架空の授業', firstSeenAt: T0, lastSeenAt: T0, subjectId },
		]);

		expect(store.unresolve(2026, '架空の授業')).toBe(true);
		expect(store.listResolved(2026)).toEqual([]);
		expect(store.listUnresolved(2026).map((l) => l.lessonName)).toEqual(['別の名前', '架空の授業']);
		expect(store.unresolve(2026, '記録のない名前')).toBe(false);
	});
});

function insertSubject(): number {
	return createSubjectStore(database).upsert(
		{
			academicYear: 2026,
			syllabusId: '100001',
			name: '架空の科目',
			teacher: null,
			credits: 2,
			term: 'fall',
			attributes: {},
			syllabus: {},
			syllabusUrl: null,
		},
		T0,
	);
}
