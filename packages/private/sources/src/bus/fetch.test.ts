import { describe, expect, it, vi } from 'vitest';
import { fetchBusStopList, fetchBusStopTimetable } from './fetch.ts';

const BASE = 'https://bus.example.com';

const list = {
	schemaVersion: 2,
	generatedAt: '2026-10-09T20:00:00.000Z',
	generations: [{ code: 20261001, name: '令和8年10月1日', current: true }],
	stops: [{ id: '14013', name: '亀田支所前' }],
};

const timetable = {
	schemaVersion: 2,
	generatedAt: '2026-10-09T20:00:00.000Z',
	fetchedAt: '2026-10-09T18:31:38.194Z',
	generation: list.generations[0],
	stop: list.stops[0],
	timetables: [
		{
			platformNo: 1,
			platformName: '1 番のりば',
			day: 'weekday',
			notes: ['△＝学校休日運休'],
			departures: [
				{ time: '08:05', routes: ['55A'], via: '赤川通', destination: '赤川', marks: [] },
			],
		},
	],
};

function json(body: unknown, init: ResponseInit = {}) {
	return Promise.resolve(
		new Response(JSON.stringify(body), {
			...init,
			headers: { 'content-type': 'application/json', ...init.headers },
		}),
	);
}

describe('fetchBusStopList', () => {
	it('停留所の一覧を取得し、ETag を返す', async () => {
		const fetchMock = vi.fn(() => json(list, { headers: { etag: '"a"' } }));
		const result = await fetchBusStopList({ fetch: fetchMock, baseUrl: BASE });
		expect(result).toEqual({
			kind: 'updated',
			etag: '"a"',
			list: { generatedAt: list.generatedAt, generations: list.generations, stops: list.stops },
		});
		expect(fetchMock).toHaveBeenCalledWith(`${BASE}/v1/stops`, expect.anything());
	});

	it('基準の URL の末尾にスラッシュがあっても、二重にしない', async () => {
		const fetchMock = vi.fn(() => json(list));
		await fetchBusStopList({ fetch: fetchMock, baseUrl: `${BASE}/` });
		expect(fetchMock).toHaveBeenCalledWith(`${BASE}/v1/stops`, expect.anything());
	});

	it('前回の ETag を送り、304 なら変わっていないと返す', async () => {
		const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
			expect(new Headers(init?.headers).get('if-none-match')).toBe('"a"');
			return Promise.resolve(new Response(null, { status: 304 }));
		});
		expect(await fetchBusStopList({ fetch: fetchMock, baseUrl: BASE, etag: '"a"' })).toEqual({
			kind: 'not-modified',
		});
	});

	it('503 は、サーバーにまだ時刻表がないこととして、失敗と区別する', async () => {
		const result = await fetchBusStopList({
			fetch: () => json({ error: 'no data' }, { status: 503 }),
			baseUrl: BASE,
		});
		expect(result.kind).toBe('not-ready');
	});

	it('形が契約と違えば、失敗として返す', async () => {
		const result = await fetchBusStopList({
			fetch: () => json({ ...list, schemaVersion: 3 }),
			baseUrl: BASE,
		});
		expect(result.kind).toBe('failed');
	});

	it('通信の例外は投げず、失敗として返す', async () => {
		const result = await fetchBusStopList({
			fetch: () => Promise.reject(new Error('boom')),
			baseUrl: BASE,
		});
		expect(result.kind).toBe('failed');
		expect(result.kind === 'failed' && result.message).toContain('boom');
	});
});

describe('fetchBusStopTimetable', () => {
	it('停留所と版を指定して、発車表を取得する', async () => {
		const fetchMock = vi.fn(() => json(timetable, { headers: { etag: '"t"' } }));
		const result = await fetchBusStopTimetable({
			fetch: fetchMock,
			baseUrl: BASE,
			stopId: '14013',
			generation: 20261001,
		});
		const expected = { ...timetable, schemaVersion: undefined };
		expect(result).toEqual({ kind: 'updated', etag: '"t"', timetable: expected });
		expect(fetchMock).toHaveBeenCalledWith(
			`${BASE}/v1/stops/14013?generation=20261001`,
			expect.anything(),
		);
	});

	it('停留所のコードは URL に使える形にする', async () => {
		const fetchMock = vi.fn(() => json(timetable));
		await fetchBusStopTimetable({ fetch: fetchMock, baseUrl: BASE, stopId: 'a/b' });
		expect(fetchMock).toHaveBeenCalledWith(`${BASE}/v1/stops/a%2Fb`, expect.anything());
	});

	it('404 は、サーバーにその停留所か版がないこととして返す', async () => {
		const result = await fetchBusStopTimetable({
			fetch: () => json({ error: 'not found' }, { status: 404 }),
			baseUrl: BASE,
			stopId: '1',
		});
		expect(result.kind).toBe('not-found');
	});

	it('発車の時刻が HH:MM でなければ、失敗として返す', async () => {
		const platform = timetable.timetables[0]!;
		const broken = {
			...timetable,
			timetables: [{ ...platform, departures: [{ ...platform.departures[0]!, time: '8:5' }] }],
		};
		const result = await fetchBusStopTimetable({
			fetch: () => json(broken),
			baseUrl: BASE,
			stopId: '14013',
		});
		expect(result.kind).toBe('failed');
	});
});
