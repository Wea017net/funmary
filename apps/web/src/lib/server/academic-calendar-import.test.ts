import { createAcademicCalendarStore, type Database } from '@funmary/db';
import { describe, expect, it } from 'vitest';
import {
	importAcademicCalendar,
	importAcademicCalendarPdf,
	type ParsedAcademicCalendar,
} from './academic-calendar-import.ts';
import { useTestDatabase } from '@funmary/db/testing';

let database: Database;
useTestDatabase('funmary-calendar-import-', (db) => (database = db));

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

describe('importAcademicCalendarPdf (定期処理から使う)', () => {
	const PDF = new Uint8Array([1, 2, 3]);

	it('読み取って書き込み、年度と、手で入れた値を上書きしなかった数を返す', async () => {
		createAcademicCalendarStore(database).saveTerm(
			2030,
			{ term: 'spring', start: '2030-04-01', end: '2030-07-31' },
			'manual',
			NOW,
		);
		const outcome = await importAcademicCalendarPdf(PDF, deps(), NOW, () =>
			Promise.resolve(parsed),
		);
		expect(outcome).toEqual({ kind: 'applied', academicYear: 2030, skipped: 1 });
		expect(
			createAcademicCalendarStore(database).listSubstituteDays('2030-04-01', '2031-03-31'),
		).toHaveLength(1);
	});

	it('読み取れない、警告がある、ときは書き込まない', async () => {
		expect(
			await importAcademicCalendarPdf(PDF, deps(), NOW, () =>
				Promise.resolve({ kind: 'invalid', reason: '凡例がない' }),
			),
		).toEqual({ kind: 'invalid', reason: '凡例がない' });
		expect(
			await importAcademicCalendarPdf(PDF, deps(), NOW, () =>
				Promise.resolve({ ...parsed, warnings: ['回数が合わない'] }),
			),
		).toEqual({ kind: 'has-warnings', warnings: ['回数が合わない'] });
		expect(createAcademicCalendarStore(database).listTerms(2030)).toEqual([]);
	});
});
