import type { BusCatalog, BusStopTimetable } from '@funmary/core';
import { createBusStore, createHolidayStore, type Database } from '@funmary/db';
import { useTestDatabase } from '@funmary/db/testing';
import { describe, expect, it } from 'vitest';
import {
	busDayTypeOn,
	getBusStopTimetable,
	getNextBuses,
	listBusStops,
	type BusSources,
} from './bus.ts';

let database: Database;
useTestDatabase('funmary-bus-reads-', (db) => (database = db));

const catalog: BusCatalog = {
	generatedAt: '2026-10-09T20:00:00.000Z',
	generations: [
		{ code: 20261001, name: '令和8年10月1日', current: true },
		{ code: 20261020, name: '令和8年10月20日', current: false },
	],
	stops: [
		{ id: '14013', name: '亀田支所前' },
		{ id: '14023', name: 'はこだて未来大学' },
		{ id: '11003', name: '函館駅前' },
	],
};

function timetableOf(
	stopId: string,
	generationCode: number,
	times: { weekday: string[]; holiday: string[] },
): BusStopTimetable {
	return {
		generatedAt: '2026-10-09T20:00:00.000Z',
		fetchedAt: '2026-10-09T18:00:00.000Z',
		generation: catalog.generations.find((g) => g.code === generationCode)!,
		stop: catalog.stops.find((s) => s.id === stopId)!,
		timetables: (['weekday', 'holiday'] as const).map((day) => ({
			platformNo: 1,
			platformName: '1 番のりば',
			day,
			notes: ['△＝学校休日運休'],
			departures: times[day].map((time) => ({
				time,
				routes: ['55A'],
				via: '赤川通',
				destination: '赤川',
				marks: [],
			})),
		})),
	};
}

const CHECKED = new Date('2026-10-10T01:00:00Z');

function seeded(): BusSources {
	const bus = createBusStore(database);
	bus.saveCatalog(catalog, '"c"', CHECKED);
	bus.saveTimetable(
		timetableOf('14023', 20261001, { weekday: ['08:05', '09:30'], holiday: ['10:00'] }),
		null,
		CHECKED,
	);
	bus.saveTimetable(
		timetableOf('14023', 20261020, { weekday: ['08:15', '09:40'], holiday: ['10:10'] }),
		null,
		CHECKED,
	);
	bus.saveTimetable(
		timetableOf('14013', 20261001, { weekday: ['08:20'], holiday: [] }),
		null,
		CHECKED,
	);
	return { bus, holidays: createHolidayStore(database), estimateHolidays: () => [] };
}

// 2026-10-05 は月曜。日本時間 08:00 は UTC の前日 23:00
const MONDAY_8AM = new Date('2026-10-04T23:00:00Z');

describe('バスの機能を使わないとき', () => {
	const disabled: BusSources = {
		bus: null,
		holidays: { list: () => [] },
		estimateHolidays: () => [],
	};

	it('どの読み取りも null を返す', () => {
		expect(listBusStops(disabled)).toBeNull();
		expect(getBusStopTimetable(disabled, MONDAY_8AM, '14023')).toBeNull();
		expect(getNextBuses(disabled, MONDAY_8AM, {})).toBeNull();
	});
});

describe('listBusStops', () => {
	it('同期の前は、停留所を空にして返す', () => {
		const sources: BusSources = {
			bus: createBusStore(database),
			holidays: createHolidayStore(database),
			estimateHolidays: () => [],
		};
		expect(listBusStops(sources)).toEqual({
			checkedAt: null,
			generations: [],
			stops: [],
		});
	});

	it('停留所と版の一覧を返し、既定で強調する停留所に印を付ける', () => {
		const result = listBusStops(seeded());
		expect(result?.checkedAt).toBe(CHECKED.toISOString());
		expect(result?.generations).toHaveLength(2);
		expect(result?.stops).toEqual([
			{ id: '14013', name: '亀田支所前', highlighted: true },
			{ id: '14023', name: 'はこだて未来大学', highlighted: true },
			{ id: '11003', name: '函館駅前', highlighted: false },
		]);
	});
});

describe('getBusStopTimetable', () => {
	it('版を省くと、今日に有効な版の発車表を返す', () => {
		const result = getBusStopTimetable(seeded(), MONDAY_8AM, '14023');
		expect(result?.generation.code).toBe(20261001);
		expect(result?.platforms[0]).toMatchObject({
			platformNo: 1,
			day: 'weekday',
			notes: ['△＝学校休日運休'],
		});
		expect(result?.platforms[0]?.departures.map((d) => d.time)).toEqual(['08:05', '09:30']);
	});

	it('版を指定すれば、その版の発車表を返す', () => {
		const result = getBusStopTimetable(seeded(), MONDAY_8AM, '14023', 20261020);
		expect(result?.platforms[0]?.departures.map((d) => d.time)).toEqual(['08:15', '09:40']);
	});

	it('保存していない停留所や版は null', () => {
		expect(getBusStopTimetable(seeded(), MONDAY_8AM, '99999')).toBeNull();
		expect(getBusStopTimetable(seeded(), MONDAY_8AM, '14023', 20200101)).toBeNull();
	});
});

describe('getNextBuses', () => {
	it('停留所を省くと、強調する停留所ごとに、次の発車を返す', () => {
		const result = getNextBuses(seeded(), MONDAY_8AM, { limit: 2 });
		expect(result?.stops.map((entry) => entry.stop.id)).toEqual(['14023', '14013']);
		const first = result?.stops[0];
		expect(first?.upcoming.map((u) => [u.time, u.minutesUntil])).toEqual([
			['08:05', 5],
			['09:30', 90],
		]);
		expect(first?.upcoming[0]).toMatchObject({
			routes: ['55A'],
			via: '赤川通',
			destination: '赤川',
			serviceDate: '2026-10-05',
		});
		expect(first?.platforms[0]).toMatchObject({ platformNo: 1, notes: ['△＝学校休日運休'] });
	});

	it('停留所を指定すると、その停留所だけを返す', () => {
		const result = getNextBuses(seeded(), MONDAY_8AM, { stopId: '14013' });
		expect(result?.stops.map((entry) => entry.stop.id)).toEqual(['14013']);
	});

	it('limit で件数を絞る', () => {
		const result = getNextBuses(seeded(), MONDAY_8AM, { stopId: '14023', limit: 1 });
		expect(result?.stops[0]?.upcoming).toHaveLength(1);
	});

	it('祝日は休日の発車表を使う', () => {
		const sources = seeded();
		const result = getNextBuses(
			{ ...sources, estimateHolidays: () => [{ date: '2026-10-05', name: '仮の祝日' }] },
			MONDAY_8AM,
			{ stopId: '14023' },
		);
		expect(result?.stops[0]?.upcoming[0]?.time).toBe('10:00');
	});

	it('最終のあとは翌日の始発を返し、版が変わる日は新しい版で数える', () => {
		// 2026-10-19 (月) 23:00 の次は、10-20 (火) から新しい版
		const night = new Date('2026-10-19T14:00:00Z');
		const result = getNextBuses(seeded(), night, { stopId: '14023', limit: 1 });
		expect(result?.stops[0]?.upcoming[0]).toMatchObject({
			serviceDate: '2026-10-20',
			time: '08:15',
		});
	});

	it('発車表をまだ保存していない停留所は、発車を空にして返す', () => {
		const result = getNextBuses(seeded(), MONDAY_8AM, { stopId: '11003' });
		expect(result?.stops[0]).toMatchObject({ stop: { id: '11003' }, upcoming: [] });
	});

	it('一覧にない停留所は null', () => {
		expect(getNextBuses(seeded(), MONDAY_8AM, { stopId: '99999' })).toBeNull();
	});

	it('いつ時刻表を確かめたかを返す', () => {
		const result = getNextBuses(seeded(), MONDAY_8AM, { stopId: '14023' });
		expect(result?.stops[0]?.checkedAt).toBe(CHECKED.toISOString());
	});
});

describe('busDayTypeOn', () => {
	it('土曜、日曜、祝日は休日、ほかは平日', () => {
		const sources = seeded();
		expect(busDayTypeOn(sources, '2026-10-05')).toBe('weekday');
		expect(busDayTypeOn(sources, '2026-10-10')).toBe('holiday');
		const withHoliday = {
			...sources,
			estimateHolidays: () => [{ date: '2026-10-05', name: '仮の祝日' }],
		};
		expect(busDayTypeOn(withHoliday, '2026-10-05')).toBe('holiday');
	});
});
