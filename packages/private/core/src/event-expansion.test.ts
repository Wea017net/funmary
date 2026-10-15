import { describe, expect, it } from 'vitest';
import { expandUserEvents } from './event-expansion.ts';
import type { UserEvent } from './user-events.ts';

const base: UserEvent = {
	id: 1,
	title: '架空のサークル',
	location: '架空の部室',
	notes: null,
	startDate: '2026-10-05',
	endDate: '2026-10-05',
	time: { kind: 'time', start: '18:00', end: '19:30' },
	rrule: null,
	excludedDates: [],
};

const dates = (events: UserEvent[], from: string, to: string) =>
	expandUserEvents(events, from, to).map((o) => o.startDate);

describe('expandUserEvents: 単発と数日にわたる予定', () => {
	it('単発の予定は、その日だけ出す。期間の外なら出さない', () => {
		expect(dates([base], '2026-10-01', '2026-10-31')).toEqual(['2026-10-05']);
		expect(dates([base], '2026-10-06', '2026-10-31')).toEqual([]);
		expect(dates([base], '2026-09-01', '2026-10-04')).toEqual([]);
	});

	it('数日にわたる予定は、期間に少しでも重なれば、始まりの日で 1 件出し、終わりの日を持つ', () => {
		const camp: UserEvent = {
			...base,
			startDate: '2026-10-05',
			endDate: '2026-10-08',
			time: { kind: 'allDay' },
		};
		expect(expandUserEvents([camp], '2026-10-07', '2026-10-20')).toMatchObject([
			{ startDate: '2026-10-05', endDate: '2026-10-08' },
		]);
		expect(dates([camp], '2026-10-09', '2026-10-20')).toEqual([]);
	});

	it('時限で決めた予定は、時限の時刻に直し、時限の番号も持つ。複数の時限にまたがれる', () => {
		const event: UserEvent = { ...base, time: { kind: 'period', from: 2, to: 3 } };
		expect(expandUserEvents([event], '2026-10-05', '2026-10-05')[0]).toMatchObject({
			allDay: false,
			start: '10:40',
			end: '14:40',
			periods: { from: 2, to: 3 },
		});
	});

	it('終日と時刻の予定を、終日、時刻の順に並べる', () => {
		const day: UserEvent = { ...base, id: 2, time: { kind: 'allDay' } };
		const late: UserEvent = {
			...base,
			id: 3,
			time: { kind: 'time', start: '20:00', end: '21:00' },
		};
		const early: UserEvent = {
			...base,
			id: 4,
			time: { kind: 'time', start: '08:00', end: '09:00' },
		};
		expect(
			expandUserEvents([late, early, day], '2026-10-05', '2026-10-05').map((o) => o.eventId),
		).toEqual([2, 4, 3]);
	});
});

describe('expandUserEvents: 繰り返し (ical.js)', () => {
	const weekly: UserEvent = { ...base, rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2' };

	it('隔週の月曜と水曜', () => {
		expect(dates([weekly], '2026-10-05', '2026-11-10')).toEqual([
			'2026-10-05',
			'2026-10-07',
			'2026-10-19',
			'2026-10-21',
			'2026-11-02',
			'2026-11-04',
		]);
	});

	it('除外した日は出さない', () => {
		const skipped = { ...weekly, excludedDates: ['2026-10-07', '2026-11-02'] };
		expect(dates([skipped], '2026-10-05', '2026-11-10')).toEqual([
			'2026-10-05',
			'2026-10-19',
			'2026-10-21',
			'2026-11-04',
		]);
	});

	it('毎月の第 2 火曜と、月の 31 日 (31 日のない月は飛ばす)', () => {
		const nth: UserEvent = {
			...base,
			startDate: '2026-10-13',
			endDate: '2026-10-13',
			rrule: 'FREQ=MONTHLY;BYDAY=2TU',
		};
		expect(dates([nth], '2026-10-01', '2027-01-31')).toEqual([
			'2026-10-13',
			'2026-11-10',
			'2026-12-08',
			'2027-01-12',
		]);
		const last: UserEvent = {
			...base,
			startDate: '2026-10-31',
			endDate: '2026-10-31',
			rrule: 'FREQ=MONTHLY;BYMONTHDAY=31',
		};
		expect(dates([last], '2026-10-01', '2027-03-31')).toEqual([
			'2026-10-31',
			'2026-12-31',
			'2027-01-31',
			'2027-03-31',
		]);
	});

	it('回数と終わりの日を守る。毎年の予定も出せる', () => {
		expect(dates([{ ...base, rrule: 'FREQ=DAILY;COUNT=3' }], '2026-10-01', '2027-01-01')).toEqual([
			'2026-10-05',
			'2026-10-06',
			'2026-10-07',
		]);
		expect(
			dates([{ ...base, rrule: 'FREQ=WEEKLY;UNTIL=20261020' }], '2026-10-01', '2027-01-01'),
		).toEqual(['2026-10-05', '2026-10-12', '2026-10-19']);
		expect(dates([{ ...base, rrule: 'FREQ=YEARLY' }], '2026-10-01', '2029-12-31')).toEqual([
			'2026-10-05',
			'2027-10-05',
			'2028-10-05',
			'2029-10-05',
		]);
	});

	it('繰り返しの数日にわたる予定は、開始が期間の前でも、期間に重なる回を出す', () => {
		const weeklyCamp: UserEvent = {
			...base,
			startDate: '2026-10-05',
			endDate: '2026-10-07',
			time: { kind: 'allDay' },
			rrule: 'FREQ=WEEKLY',
		};
		expect(expandUserEvents([weeklyCamp], '2026-10-13', '2026-10-13')).toMatchObject([
			{ startDate: '2026-10-12', endDate: '2026-10-14' },
		]);
	});

	it('壊れた繰り返しの指定は、単発として扱い、例外にしない', () => {
		expect(dates([{ ...base, rrule: 'FREQ=BOGUS' }], '2026-10-01', '2026-10-31')).toEqual([
			'2026-10-05',
		]);
	});

	it('終わりのない繰り返しでも、展開の回数に上限を置く', () => {
		const daily: UserEvent = {
			...base,
			startDate: '1900-01-01',
			endDate: '1900-01-01',
			rrule: 'FREQ=DAILY',
		};
		expect(dates([daily], '2026-10-05', '2026-10-05').length).toBeLessThanOrEqual(1);
	});
});
