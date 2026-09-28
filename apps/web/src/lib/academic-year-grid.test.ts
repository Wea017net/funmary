import { describe, expect, it } from 'vitest';
import { dayMarks, yearGrid } from './academic-year-grid.ts';

describe('yearGrid', () => {
	it('4 月から翌年 3 月までの 12 か月を、日曜始まりの週に並べる', () => {
		const months = yearGrid(2026);
		expect(months.map((month) => month.label)).toEqual([
			'2026 年 4 月',
			'5 月',
			'6 月',
			'7 月',
			'8 月',
			'9 月',
			'10 月',
			'11 月',
			'12 月',
			'2027 年 1 月',
			'2 月',
			'3 月',
		]);
		// 2026-04-01 は水曜
		const [april] = months;
		expect(april?.weeks[0]?.map((day) => day?.date ?? null)).toEqual([
			null,
			null,
			null,
			'2026-04-01',
			'2026-04-02',
			'2026-04-03',
			'2026-04-04',
		]);
		expect(april?.weeks.flat().filter(Boolean)).toHaveLength(30);
		const march = months[11];
		expect(march?.weeks.flat().filter(Boolean).at(-1)).toEqual({
			date: '2027-03-31',
			day: 31,
			weekday: 3,
		});
		// 週は 7 日ずつ。最後の週の後ろも空けて埋める
		expect(months.every((month) => month.weeks.every((week) => week.length === 7))).toBe(true);
	});
});

describe('dayMarks', () => {
	const input = {
		terms: [
			{ term: 'spring', start: '2026-04-06', end: '2026-07-24' },
			{ term: 'q1', start: '2026-04-06', end: '2026-06-04' },
			{ term: 'fall', start: '2026-09-24', end: '2027-01-21' },
		],
		holidays: [{ date: '2026-04-29', name: '昭和の日' }],
		substituteDays: [{ date: '2026-04-30', weekday: 3 }],
		noClassDays: [{ date: '2026-12-28', label: null }],
	};

	it('その日に掛かる学期、祝日、振替授業日、全学の休講日を集める', () => {
		expect(dayMarks('2026-04-06', input)).toEqual({
			terms: ['spring', 'q1'],
			band: 'spring',
			holiday: null,
			substitute: null,
			noClass: null,
		});
		expect(dayMarks('2026-04-29', input)).toMatchObject({ holiday: '昭和の日' });
		expect(dayMarks('2026-04-30', input)).toMatchObject({ substitute: 3 });
		expect(dayMarks('2026-12-28', input)).toMatchObject({
			band: 'fall',
			noClass: { label: null },
		});
		expect(dayMarks('2026-08-01', input)).toMatchObject({ terms: [], band: null });
	});
});
