import { describe, expect, it } from 'vitest';
import type { BusPlatformTimetable, BusStopTimetable } from './bus.ts';
import { filterByDirection, matchArrivals, mentionsStop } from './bus-direction.ts';

const timesOf = (result: ReturnType<typeof filterByDirection>, day = 'weekday') =>
	result?.timetables.filter((t) => t.day === day).flatMap((t) => t.departures.map((d) => d.time)) ??
	[];

const GENERATION = { code: 20261001, name: '令和8年10月1日', current: true };

function stopTimetable(
	id: string,
	name: string,
	departures: { time: string; destination: string; via?: string; routes?: string[] }[],
	day: BusPlatformTimetable['day'] = 'weekday',
): BusStopTimetable {
	return {
		generatedAt: '2026-10-10T00:00:00.000Z',
		generation: GENERATION,
		stop: { id, name },
		timetables: [
			{
				platformNo: 1,
				day,
				notes: [],
				departures: departures.map((d) => ({
					time: d.time,
					routes: d.routes ?? ['55A'],
					destination: d.destination,
					...(d.via === undefined ? {} : { via: d.via }),
					marks: [],
				})),
			},
		],
	};
}

const UNIVERSITY = { id: '14023', name: 'はこだて未来大学' };

// 亀田支所前 (A) は、函館駅前と未来大の間にある。未来大に向かう便は、経由か行先に未来大が入る
const kameda = stopTimetable('14013', '亀田支所前', [
	{ time: '08:05', destination: '赤川', via: '赤川通・はこだて未来大学' },
	{ time: '08:20', destination: '函館駅前', via: '五稜郭' },
	{ time: '08:35', destination: '赤川', via: '赤川通・はこだて未来大学' },
	{ time: '09:00', destination: 'はこだて未来大学' },
]);
// 未来大の発車は、函館駅前へ向かう便 (亀田支所前を通る) と、赤川へ向かう便がある
const university = stopTimetable('14023', 'はこだて未来大学', [
	{ time: '08:10', destination: '函館駅前', via: '亀田支所前・五稜郭' },
	{ time: '08:25', destination: '赤川' },
	{ time: '08:40', destination: '千代台', via: '亀田支所前' },
	{ time: '09:00', destination: '函館駅前' },
]);

describe('mentionsStop', () => {
	it('停留所の名前を含めば true。全角と半角、空白の違いは無視する', () => {
		expect(mentionsStop('赤川通・はこだて未来大学', 'はこだて未来大学')).toBe(true);
		expect(mentionsStop('赤川通・未来大', 'はこだて未来大学', ['未来大'])).toBe(true);
		expect(mentionsStop('赤川通・未来大', 'はこだて未来大学')).toBe(false);
		expect(mentionsStop('亀田支所前', '亀田支所前')).toBe(true);
		expect(mentionsStop('五稜郭', '亀田支所前')).toBe(false);
		expect(mentionsStop(undefined, '亀田支所前')).toBe(false);
	});
});

describe('filterByDirection', () => {
	it('未来大へ向かう便は、A の発車のうち、経由か行先に未来大があるもの', () => {
		const result = filterByDirection('toUniversity', kameda, university, UNIVERSITY);
		expect(timesOf(result)).toEqual(['08:05', '08:35', '09:00']);
		expect(result?.stop.id).toBe('14013');
	});

	it('未来大から向かう便は、未来大の発車のうち、A から未来大と反対へ向かう便と同じ行先か、A を経由か行先に含むもの', () => {
		const result = filterByDirection('fromUniversity', kameda, university, UNIVERSITY);
		// 函館駅前行 (A にも 08:20 の函館駅前行がある) と、亀田支所前を経由する千代台行。赤川行は、A から未来大へ向かう便なので含めない
		expect(timesOf(result)).toEqual(['08:10', '08:40', '09:00']);
		expect(result?.stop.id).toBe('14023');
	});

	it('日の区分ごとに、のりばを保って返す', () => {
		const holiday = stopTimetable(
			'14013',
			'亀田支所前',
			[{ time: '10:00', destination: '赤川', via: 'はこだて未来大学' }],
			'holiday',
		);
		const merged: BusStopTimetable = {
			...kameda,
			timetables: [...kameda.timetables, ...holiday.timetables],
		};
		const result = filterByDirection('toUniversity', merged, university, UNIVERSITY);
		expect(timesOf(result, 'holiday')).toEqual(['10:00']);
		expect(timesOf(result)).toEqual(['08:05', '08:35', '09:00']);
	});

	it('発車表がなければ null', () => {
		expect(filterByDirection('toUniversity', null, university, UNIVERSITY)).toBeNull();
		expect(filterByDirection('fromUniversity', kameda, null, UNIVERSITY)).toBeNull();
	});
});

describe('matchArrivals', () => {
	const dep = (time: string, destination: string, routes = ['55A']) => ({
		time,
		routes,
		destination,
		marks: [] as string[],
	});

	it('同じ行き先と系統で、あとに発車する便を、到着として 1 対 1 に結ぶ', () => {
		const result = matchArrivals(
			[dep('08:05', '赤川'), dep('08:35', '赤川')],
			[dep('08:25', '赤川'), dep('08:50', '赤川'), dep('09:20', '赤川')],
		);
		expect(result).toEqual(['08:25', '08:50']);
	});

	it('行き先が違う便や、系統が重ならない便とは結ばない', () => {
		const result = matchArrivals(
			[dep('08:05', '赤川', ['55A'])],
			[dep('08:20', '函館駅前', ['55A']), dep('08:22', '赤川', ['55G'])],
		);
		expect(result).toEqual([null]);
	});

	it('時間が離れすぎた便とは結ばない', () => {
		expect(matchArrivals([dep('08:05', '赤川')], [dep('10:00', '赤川')])).toEqual([null]);
	});

	it('24 時以降の時刻も、分で比べる', () => {
		expect(matchArrivals([dep('23:50', '赤川')], [dep('24:10', '赤川')])).toEqual(['24:10']);
	});

	it('結ぶ相手がなければ null。1 つの到着を、2 つの便には使わない', () => {
		expect(
			matchArrivals([dep('08:05', '赤川'), dep('08:10', '赤川')], [dep('08:30', '赤川')]),
		).toEqual(['08:30', null]);
	});
});
