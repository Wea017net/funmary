import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createCourseStore,
	createSubjectStore,
	createUnmatchedLessonStore,
	openDatabase,
	type Database,
} from '@funmary/db';
import type { TimetablePdfEntry, TimetablePdfResult } from '@funmary/sources';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importTimetable } from './timetable-import.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-timetable-import-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date('2027-03-31T00:00:00Z');

function deps() {
	return {
		subjects: createSubjectStore(database),
		courses: createCourseStore(database),
		unmatched: createUnmatchedLessonStore(database),
	};
}

function addSubject(name: string, term: string, syllabusId: string): number {
	return createSubjectStore(database).upsert(
		{
			academicYear: 2027,
			syllabusId,
			name,
			teacher: null,
			credits: 2,
			term,
			attributes: {},
			syllabus: {},
			syllabusUrl: null,
		},
		NOW,
	);
}

const entry = (over: Partial<TimetablePdfEntry> = {}): TimetablePdfEntry => ({
	weekday: 1,
	period: 1,
	quarter: null,
	subject: '架空演習',
	teachers: ['架空'],
	title: '架空演習 (架空)',
	classes: '1-AB',
	rooms: ['363'],
	notes: [],
	...over,
});

const parsed = (
	over: Partial<Extract<TimetablePdfResult, { kind: 'ok' }>> = {},
): Extract<TimetablePdfResult, { kind: 'ok' }> => ({
	kind: 'ok',
	term: 'spring',
	academicYear: 2027,
	updatedOn: '2027-03-20',
	entries: [entry()],
	intensive: [],
	quality: { entryCount: 1, classRatio: 1, roomRatio: 1, weakestAnchorWeight: 30 },
	warnings: [],
	...over,
});

describe('importTimetable', () => {
	it('既定では確かめるだけで、DB に書き込まない', () => {
		const subjectId = addSubject('架空演習1-AB', 'spring', '1');
		const report = importTimetable(parsed(), deps(), { apply: false, now: NOW });
		expect(report).toMatchObject({
			kind: 'planned',
			academicYear: 2027,
			term: 'spring',
			slots: [{ subjectId, weekday: 1, period: 1, room: '363', method: 'exact' }],
			applied: null,
		});
		expect(deps().courses.slotsOf(subjectId)).toEqual([]);
	});

	it('apply なら、枠を出どころ pdf で足し、照合できなかった名前を記録する', () => {
		const subjectId = addSubject('架空演習1-AB', 'spring', '1');
		const report = importTimetable(
			parsed({ entries: [entry(), entry({ subject: '架空の別の授業', classes: '2' })] }),
			deps(),
			{ apply: true, now: NOW },
		);
		expect(report).toMatchObject({
			kind: 'planned',
			unmatched: [{ lessonName: '架空の別の授業2', reason: 'unmatched' }],
			applied: { added: 1, updated: 0, conflicts: [], newUnmatched: 1 },
		});
		expect(deps().courses.slotsOf(subjectId)).toEqual([
			{ weekday: 1, period: 1, room: '363', source: 'pdf', createdBy: null },
		]);
		expect(
			deps()
				.unmatched.listUnresolved(2027)
				.map((u) => u.lessonName),
		).toEqual(['架空の別の授業2']);
	});

	it('管理画面で紐付けた名前は、次の取り込みで、その科目の枠になる', () => {
		const subjectId = addSubject('架空演習1-AB', 'spring', '1');
		const other = parsed({ entries: [entry({ subject: '架空演習 (再)', classes: '1-AB' })] });
		importTimetable(other, deps(), { apply: true, now: NOW });
		deps().unmatched.resolve(2027, '架空演習 (再)1-AB', subjectId);

		const report = importTimetable(other, deps(), { apply: true, now: NOW });
		expect(report).toMatchObject({
			unmatched: [],
			slots: [{ subjectId, method: 'manual' }],
			applied: { added: 1 },
		});
	});

	it('時間割の学期に合う科目だけと照合する (後期に同じ名前の科目があっても、前期の時間割は前期の科目に付ける)', () => {
		const spring = addSubject('架空演習1-AB', 'spring', '1');
		addSubject('架空演習1-AB', 'fall', '2');
		const report = importTimetable(parsed(), deps(), { apply: false, now: NOW });
		expect(report).toMatchObject({ slots: [{ subjectId: spring }] });
	});

	it('年度は、指定があればそれを使い、なければ PDF の表題から読む', () => {
		addSubject('架空演習1-AB', 'spring', '1');
		expect(
			importTimetable(parsed({ academicYear: null }), deps(), { apply: false, now: NOW }),
		).toEqual({ kind: 'no-year' });
		expect(
			importTimetable(parsed({ academicYear: null }), deps(), {
				apply: false,
				now: NOW,
				academicYear: 2027,
			}),
		).toMatchObject({ kind: 'planned', academicYear: 2027 });
	});

	it('その年度の科目がまだなければ、取り込まない (先にシラバスの取り込みが要る)', () => {
		expect(importTimetable(parsed(), deps(), { apply: true, now: NOW })).toEqual({
			kind: 'no-subjects',
			academicYear: 2027,
		});
	});

	it('読み取りに警告があれば、ignoreWarnings を付けないかぎり書き込まない', () => {
		const subjectId = addSubject('架空演習1-AB', 'spring', '1');
		const warned = parsed({ warnings: ['読めたコマが少ない'] });
		expect(importTimetable(warned, deps(), { apply: true, now: NOW })).toEqual({
			kind: 'has-warnings',
			warnings: ['読めたコマが少ない'],
		});
		expect(deps().courses.slotsOf(subjectId)).toEqual([]);
		expect(
			importTimetable(warned, deps(), { apply: true, now: NOW, ignoreWarnings: true }),
		).toMatchObject({ kind: 'planned', applied: { added: 1 } });
	});
});
