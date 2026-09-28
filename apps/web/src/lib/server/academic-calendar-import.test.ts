import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAcademicCalendarStore, openDatabase, type Database } from '@funmary/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importAcademicCalendar, type ParsedAcademicCalendar } from './academic-calendar-import.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-calendar-import-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date('2030-03-20T00:00:00Z');

const parsed: ParsedAcademicCalendar = {
	kind: 'ok',
	academicYear: 2030,
	terms: [
		{ term: 'spring', start: '2030-04-08', end: '2030-07-26' },
		{ term: 'q1', start: '2030-04-08', end: '2030-06-06' },
	],
	substituteDays: [{ date: '2030-05-01', weekday: 1 }],
	noClassDays: [
		{ date: '2030-04-29', label: '昭和の日' },
		{ date: '2030-06-14', label: '休講' },
	],
	warnings: [],
};

function deps() {
	return { calendar: createAcademicCalendarStore(database), holidays: ['2030-04-29'] };
}

describe('学年暦の取り込み', () => {
	it('apply がなければ、祝日を除いた取り込む内容を返すだけで、書き込まない', () => {
		const report = importAcademicCalendar(parsed, deps(), { apply: false, now: NOW });
		expect(report).toEqual({
			kind: 'planned',
			academicYear: 2030,
			terms: parsed.terms,
			substituteDays: parsed.substituteDays,
			noClassDays: [{ date: '2030-06-14', label: '休講' }],
			warnings: [],
			applied: null,
		});
		expect(createAcademicCalendarStore(database).listTerms(2030)).toEqual([]);
	});

	it('apply のときは、学期、振替授業日、休講日を、学年暦から自動で取った値として書き込む', () => {
		importAcademicCalendar(parsed, deps(), { apply: true, now: NOW });
		const calendar = createAcademicCalendarStore(database);
		expect(calendar.listTerms(2030)).toHaveLength(2);
		expect(calendar.listTerms(2030)).toEqual(
			expect.arrayContaining([
				{ term: 'spring', start: '2030-04-08', end: '2030-07-26', source: 'auto' },
				{ term: 'q1', start: '2030-04-08', end: '2030-06-06', source: 'auto' },
			]),
		);
		expect(calendar.listSubstituteDays('2030-04-01', '2031-03-31')).toEqual([
			{ date: '2030-05-01', weekday: 1 },
		]);
		expect(calendar.listNoClassDays('2030-04-01', '2031-03-31')).toEqual([
			{ date: '2030-06-14', label: '休講' },
		]);
	});

	it('管理者が入れた値は上書きせず、上書きしなかったものを返す', () => {
		const calendar = createAcademicCalendarStore(database);
		calendar.saveTerm(
			2030,
			{ term: 'spring', start: '2030-04-09', end: '2030-07-26' },
			'manual',
			NOW,
		);
		calendar.saveNoClassDay('2030-06-14', '全学休講', 'manual');
		const report = importAcademicCalendar(parsed, deps(), { apply: true, now: NOW });
		expect(report).toMatchObject({
			kind: 'planned',
			applied: {
				skippedTerms: ['spring'],
				skippedSubstituteDays: [],
				skippedNoClassDays: ['2030-06-14'],
			},
		});
		expect(calendar.listTerms(2030)).toContainEqual({
			term: 'spring',
			start: '2030-04-09',
			end: '2030-07-26',
			source: 'manual',
		});
	});

	it('読み取りに警告があれば、ignoreWarnings がない限り書き込まない', () => {
		const warned = { ...parsed, warnings: ['2030-05-13 の回数が合いません'] };
		expect(importAcademicCalendar(warned, deps(), { apply: true, now: NOW })).toEqual({
			kind: 'has-warnings',
			warnings: ['2030-05-13 の回数が合いません'],
		});
		expect(createAcademicCalendarStore(database).listTerms(2030)).toEqual([]);

		importAcademicCalendar(warned, deps(), { apply: true, now: NOW, ignoreWarnings: true });
		expect(createAcademicCalendarStore(database).listTerms(2030)).toHaveLength(2);
	});
});
