import type { UserEvent } from '@funmary/core';
import { describe, expect, it } from 'vitest';
import { eventViewsByDate, eventsOnDate } from './event-view.ts';

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

describe('eventViewsByDate', () => {
	it('日付ごとに、その日にある予定を、終日、時刻の順に並べる', () => {
		const views = eventViewsByDate(
			[
				base,
				{ ...base, id: 2, title: '終日の予定', time: { kind: 'allDay' } },
				{ ...base, id: 3, title: '別の日', startDate: '2026-10-06', endDate: '2026-10-06' },
			],
			'2026-10-05',
			'2026-10-11',
		);
		expect(
			views.get('2026-10-05')?.map((view) => [view.title, view.time, view.startPeriod]),
		).toEqual([
			['終日の予定', '終日', null],
			['架空のサークル', '18:00-19:30', null],
		]);
		expect(views.get('2026-10-06')?.map((view) => view.title)).toEqual(['別の日']);
		expect(views.get('2026-10-07')).toBeUndefined();
	});

	it('数日にわたる予定は、期間のすべての日に出し、2 日目からは続きの印を付ける。範囲の外の日は作らない', () => {
		const views = eventViewsByDate(
			[{ ...base, endDate: '2026-10-07', time: { kind: 'allDay' } }],
			'2026-10-06',
			'2026-10-11',
		);
		expect([...views.keys()]).toEqual(['2026-10-06', '2026-10-07']);
		expect(views.get('2026-10-06')?.[0]).toMatchObject({ continued: true });
		const first = eventViewsByDate(
			[{ ...base, endDate: '2026-10-07', time: { kind: 'allDay' } }],
			'2026-10-05',
			'2026-10-11',
		);
		expect(first.get('2026-10-05')?.[0]).toMatchObject({ continued: false });
	});

	it('時限で決めた予定は、時限で示す。繰り返しの予定は、各回の日に出す', () => {
		const views = eventViewsByDate(
			[{ ...base, time: { kind: 'period', from: 2, to: 3 }, rrule: 'FREQ=WEEKLY' }],
			'2026-10-05',
			'2026-10-19',
		);
		expect([...views.keys()]).toEqual(['2026-10-05', '2026-10-12', '2026-10-19']);
		expect(views.get('2026-10-12')?.[0]).toMatchObject({
			time: '2 限から 3 限',
			startPeriod: 2,
		});
	});
});

describe('加えた予定', () => {
	it('加えた予定の ID を渡すと、その予定に印を付ける', () => {
		const views = eventViewsByDate(
			[base, { ...base, id: 2, title: '加えた予定' }],
			'2026-10-05',
			'2026-10-05',
			new Set([2]),
		);
		expect(views.get('2026-10-05')?.map((view) => [view.title, view.added])).toEqual([
			['架空のサークル', false],
			['加えた予定', true],
		]);
	});
});

describe('eventsOnDate', () => {
	it('その日だけの予定を返す', () => {
		expect(eventsOnDate([base], '2026-10-05').map((view) => view.title)).toEqual([
			'架空のサークル',
		]);
		expect(eventsOnDate([base], '2026-10-06')).toEqual([]);
	});
});
