import type { BusCatalog, BusStopTimetable } from '@funmary/core';
import { describe, expect, it } from 'vitest';
import { createBusStore } from './bus-store.ts';
import type { Database } from './database.ts';
import { useTestDatabase } from './testing.ts';

let database: Database;
useTestDatabase('funmary-bus-', (db) => (database = db));

const catalog: BusCatalog = {
	generatedAt: '2026-10-09T20:00:00.000Z',
	generations: [
		{ code: 20261001, name: '令和8年10月1日', current: true },
		{ code: 20261020, name: '令和8年10月20日', current: false },
	],
	stops: [{ id: '14013', name: '亀田支所前' }],
};

function timetable(generationCode: number): BusStopTimetable {
	return {
		generatedAt: '2026-10-09T20:00:00.000Z',
		generation: { code: generationCode, name: '版', current: generationCode === 20261001 },
		stop: { id: '14013', name: '亀田支所前' },
		timetables: [
			{
				platformNo: 1,
				day: 'weekday',
				notes: [],
				departures: [{ time: '08:05', routes: ['55A'], marks: [] }],
			},
		],
	};
}

const T0 = new Date('2026-10-10T01:00:00Z');
const T1 = new Date('2026-10-11T01:00:00Z');

describe('createBusStore', () => {
	it('何も保存していなければ、一覧も発車表も null', () => {
		const store = createBusStore(database);
		expect(store.getCatalog()).toBeNull();
		expect(store.getTimetable('14013', 20261001)).toBeNull();
	});

	it('停留所の一覧を、ETag と確かめた日時つきで保存して読み出す', () => {
		const store = createBusStore(database);
		store.saveCatalog(catalog, '"a"', T0);
		expect(store.getCatalog()).toEqual({ catalog, etag: '"a"', checkedAt: T0 });
	});

	it('一覧を保存し直すと、置き換わる', () => {
		const store = createBusStore(database);
		store.saveCatalog(catalog, '"a"', T0);
		store.saveCatalog({ ...catalog, stops: [] }, '"b"', T1);
		expect(store.getCatalog()).toMatchObject({ etag: '"b"', checkedAt: T1 });
		expect(store.getCatalog()?.catalog.stops).toEqual([]);
	});

	it('変わっていなかったときは、内容を触らず確かめた日時だけ更新する', () => {
		const store = createBusStore(database);
		store.saveCatalog(catalog, '"a"', T0);
		store.touchCatalog(T1);
		expect(store.getCatalog()).toEqual({ catalog, etag: '"a"', checkedAt: T1 });
	});

	it('発車表を、停留所と版の組で保存して読み出す', () => {
		const store = createBusStore(database);
		store.saveTimetable(timetable(20261001), '"t1"', T0);
		store.saveTimetable(timetable(20261020), '"t2"', T0);
		expect(store.getTimetable('14013', 20261001)).toEqual({
			timetable: timetable(20261001),
			etag: '"t1"',
			checkedAt: T0,
		});
		expect(store.getTimetable('14013', 20261020)?.etag).toBe('"t2"');
	});

	it('発車表の確かめた日時だけを更新できる', () => {
		const store = createBusStore(database);
		store.saveTimetable(timetable(20261001), '"t1"', T0);
		store.touchTimetable('14013', 20261001, T1);
		expect(store.getTimetable('14013', 20261001)).toMatchObject({ etag: '"t1"', checkedAt: T1 });
	});

	it('一覧にない版と停留所の発車表を捨てる', () => {
		const store = createBusStore(database);
		store.saveTimetable(timetable(20260401), '"old"', T0);
		store.saveTimetable(timetable(20261001), '"t1"', T0);
		store.pruneTimetables({ generations: [20261001], stopIds: ['14013'] });
		expect(store.getTimetable('14013', 20260401)).toBeNull();
		expect(store.getTimetable('14013', 20261001)).not.toBeNull();
		store.pruneTimetables({ generations: [20261001], stopIds: [] });
		expect(store.getTimetable('14013', 20261001)).toBeNull();
	});
});
