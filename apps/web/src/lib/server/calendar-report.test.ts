import { describe, expect, it } from 'vitest';
import { formatCalendarImportReport, formatCalendarReport } from './calendar-report.ts';

describe('formatCalendarReport', () => {
	it('学期の期間を出どころ付きで、振替授業日と全学の休講日を日付の順に出す', () => {
		expect(
			formatCalendarReport({
				academicYear: 2026,
				terms: [
					{ term: 'spring', start: '2026-04-06', end: '2026-07-24', source: 'manual' },
					{ term: 'q1', start: '2026-04-06', end: '2026-07-24', source: 'estimated' },
					{ term: 'fall', start: '2026-09-28', end: '2027-01-21', source: 'estimated' },
				],
				substituteDays: [{ date: '2026-10-14', weekday: 1 }],
				noClassDays: [
					{ date: '2026-10-24', label: '大学祭' },
					{ date: '2026-12-28', label: null },
				],
			}),
		).toEqual([
			'2026 年度の学年暦',
			'',
			'学期の期間',
			'  前期  2026-04-06 から 2026-07-24  手入力',
			'  1Q  2026-04-06 から 2026-07-24  推定',
			'  後期  2026-09-28 から 2027-01-21  推定',
			'',
			'振替授業日',
			'  2026-10-14  月曜の授業',
			'',
			'全学の休講日',
			'  2026-10-24  大学祭',
			'  2026-12-28',
		]);
	});

	it('振替授業日や全学の休講日がなければ、ないと出す', () => {
		expect(
			formatCalendarReport({ academicYear: 2027, terms: [], substituteDays: [], noClassDays: [] }),
		).toEqual([
			'2027 年度の学年暦',
			'',
			'学期の期間',
			'  (なし)',
			'',
			'振替授業日',
			'  (なし)',
			'',
			'全学の休講日',
			'  (なし)',
		]);
	});
});

describe('formatCalendarImportReport', () => {
	const report = {
		kind: 'planned',
		academicYear: 2030,
		terms: [{ term: 'spring', start: '2030-04-08', end: '2030-07-26' }],
		substituteDays: [{ date: '2030-05-01', weekday: 1 }],
		noClassDays: [],
		warnings: ['2030-05-13 の回数が合いません'],
		applied: null,
	} as const;

	it('確かめるだけのときは、読んだ内容と警告と、書き込んでいないことを出す', () => {
		expect(formatCalendarImportReport(report)).toEqual([
			'学年暦の PDF から読んだ 2030 年度の内容',
			'',
			'学期の期間',
			'  前期  2030-04-08 から 2030-07-26  学年暦から自動',
			'',
			'振替授業日',
			'  2030-05-01  月曜の授業',
			'',
			'全学の休講日',
			'  (なし)',
			'',
			'警告: 2030-05-13 の回数が合いません',
			'確かめただけで、DB には書き込んでいません。書き込むには --apply を付けてください。',
		]);
	});

	it('書き込んだときは、上書きしなかったものを出す', () => {
		const lines = formatCalendarImportReport({
			...report,
			warnings: [],
			applied: {
				skippedTerms: ['spring'],
				skippedSubstituteDays: [],
				skippedNoClassDays: ['2030-06-14'],
			},
		});
		expect(lines.at(-1)).toBe(
			'管理画面で入れた値があるので、上書きしなかったもの: 前期、休講日 2030-06-14',
		);
	});
});
