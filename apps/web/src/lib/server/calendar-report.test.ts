import { describe, expect, it } from 'vitest';
import { formatCalendarReport } from './calendar-report.ts';

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
