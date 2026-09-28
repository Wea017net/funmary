import { describe, expect, it } from 'vitest';
import { recurrenceToRrule, rruleToRecurrence, type Recurrence } from './user-events.ts';

describe('recurrenceToRrule と rruleToRecurrence', () => {
	const roundTrip = (recurrence: Recurrence, startDate: string) => {
		const rrule = recurrenceToRrule(recurrence, startDate);
		return { rrule, back: rruleToRecurrence(rrule) };
	};

	it('毎週は、曜日を選んだ分を BYDAY にする。選ばなければ、開始日の曜日にする', () => {
		expect(
			recurrenceToRrule(
				{ freq: 'weekly', interval: 2, weekdays: [1, 3], end: { kind: 'never' } },
				'2026-10-05',
			),
		).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE');
		expect(
			recurrenceToRrule(
				{ freq: 'weekly', interval: 1, weekdays: [], end: { kind: 'never' } },
				'2026-10-07',
			),
		).toBe('FREQ=WEEKLY;BYDAY=WE');
	});

	it('毎月は、日付か、第何曜日かを選べる (最終週は -1)', () => {
		expect(
			recurrenceToRrule(
				{ freq: 'monthly', interval: 1, monthly: { by: 'day' }, end: { kind: 'never' } },
				'2026-10-15',
			),
		).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
		expect(
			recurrenceToRrule(
				{
					freq: 'monthly',
					interval: 1,
					monthly: { by: 'nth', nth: 2, weekday: 2 },
					end: { kind: 'never' },
				},
				'2026-10-13',
			),
		).toBe('FREQ=MONTHLY;BYDAY=2TU');
		expect(
			recurrenceToRrule(
				{
					freq: 'monthly',
					interval: 1,
					monthly: { by: 'nth', nth: -1, weekday: 5 },
					end: { kind: 'never' },
				},
				'2026-10-30',
			),
		).toBe('FREQ=MONTHLY;BYDAY=-1FR');
	});

	it('終わりは、回数か、日付 (UNTIL は YYYYMMDD)', () => {
		expect(
			recurrenceToRrule(
				{ freq: 'daily', interval: 1, end: { kind: 'count', count: 5 } },
				'2026-10-05',
			),
		).toBe('FREQ=DAILY;COUNT=5');
		expect(
			recurrenceToRrule(
				{ freq: 'daily', interval: 3, end: { kind: 'until', date: '2026-12-31' } },
				'2026-10-05',
			),
		).toBe('FREQ=DAILY;INTERVAL=3;UNTIL=20261231');
	});

	it('作った指定を、もとの形に読み戻せる', () => {
		const cases: [Recurrence, string][] = [
			[{ freq: 'daily', interval: 1, end: { kind: 'never' } }, '2026-10-05'],
			[
				{ freq: 'weekly', interval: 2, weekdays: [1, 3, 5], end: { kind: 'count', count: 8 } },
				'2026-10-05',
			],
			[
				{
					freq: 'monthly',
					interval: 1,
					monthly: { by: 'day' },
					end: { kind: 'until', date: '2027-03-31' },
				},
				'2026-10-15',
			],
			[
				{
					freq: 'monthly',
					interval: 3,
					monthly: { by: 'nth', nth: 2, weekday: 2 },
					end: { kind: 'never' },
				},
				'2026-10-13',
			],
			[{ freq: 'yearly', interval: 1, end: { kind: 'never' } }, '2026-10-05'],
		];
		for (const [recurrence, start] of cases) {
			expect(roundTrip(recurrence, start).back).toEqual(recurrence);
		}
	});

	it('このアプリが作らない形や、壊れた指定は、読み戻せない (null)', () => {
		expect(rruleToRecurrence('FREQ=HOURLY')).toBeNull();
		expect(rruleToRecurrence('FREQ=BOGUS')).toBeNull();
		expect(rruleToRecurrence('FREQ=WEEKLY;BYSETPOS=1;BYDAY=MO')).toBeNull();
		expect(rruleToRecurrence('')).toBeNull();
	});
});
