import { type Database } from '@funmary/db';
import { useTestDatabase } from '@funmary/db/testing';
import { describe, expect, it } from 'vitest';
import { createTestApiDeps } from '../testing.ts';
import { createV1Routes } from './routes.ts';

let database: Database;
useTestDatabase('funmary-v1-bus-leg-', (db) => (database = db));

const NOW = new Date();
const generation = { code: 20200101, name: '令和2年1月1日', current: true };
const stops = [
	{ id: '14013', name: '亀田支所前' },
	{ id: '14023', name: 'はこだて未来大学' },
];

let sequence = 0;

function setup(options: { disabled?: boolean; scopes?: ('read:transit' | 'read:lessons')[] } = {}) {
	const src = createTestApiDeps(database);
	const userId = src.users.createUser(
		{ googleSub: `a${(sequence += 1)}`, email: `a${sequence}@fun.ac.jp`, name: null, role: 'user' },
		NOW,
	);
	const token = src.accessTokens.issue(
		userId,
		{ name: 'test', scopes: options.scopes ?? ['read:transit'] },
		new Date(NOW.getTime() + 86_400_000),
		NOW,
	);
	src.bus.saveCatalog(
		{ generatedAt: NOW.toISOString(), generations: [generation], stops },
		null,
		NOW,
	);
	const table = (stop: (typeof stops)[number], destination: string, via?: string) => ({
		generatedAt: NOW.toISOString(),
		generation,
		stop,
		timetables: (['weekday', 'holiday'] as const).map((day) => ({
			platformNo: 1,
			day,
			notes: [],
			departures: ['08:00', '12:00', '18:00'].map((time) => ({
				time,
				routes: ['55A'],
				destination,
				...(via === undefined ? {} : { via }),
				marks: [],
			})),
		})),
	});
	src.bus.saveTimetable(table(stops[0]!, '赤川', '赤川通・はこだて未来大学'), null, NOW);
	src.bus.saveTimetable(table(stops[1]!, '函館駅前'), null, NOW);
	const app = createV1Routes(options.disabled ? { ...src, bus: null } : src);
	const get = (path: string) =>
		app.request(path, { headers: { Authorization: `Bearer ${token}` } });
	return { get };
}

describe('GET /api/v1/bus/legs', () => {
	it('A から未来大へ向かう便を、その日の全部と、これからの分で返す', async () => {
		const { get } = setup();
		const res = await get('/api/v1/bus/legs?stopId=14013&direction=toUniversity');
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			from: { id: string };
			to: { id: string };
			departures: { time: string }[];
			upcoming: unknown[];
		};
		expect(body.from.id).toBe('14013');
		expect(body.to.id).toBe('14023');
		expect(body.departures.map((d) => d.time)).toEqual(['08:00', '12:00', '18:00']);
		expect(body.upcoming.length).toBeGreaterThan(0);
	});

	it('日の区分を指定すると、その区分の発車を返し、これからの発車は空になる (今日の区分でなければ)', async () => {
		const { get } = setup();
		const weekday = await get('/api/v1/bus/legs?stopId=14013&direction=toUniversity&day=weekday');
		const holiday = await get('/api/v1/bus/legs?stopId=14013&direction=toUniversity&day=holiday');
		const [a, b] = [
			(await weekday.json()) as { todayDay: string; upcoming: unknown[] },
			(await holiday.json()) as { todayDay: string; upcoming: unknown[] },
		];
		const other = a.todayDay === 'weekday' ? b : a;
		expect(other.upcoming).toEqual([]);
	});

	it('read:transit がなければ 403。stopId と direction が必須で、不正なら 400', async () => {
		expect(
			(
				await setup({ scopes: ['read:lessons'] }).get(
					'/api/v1/bus/legs?stopId=14013&direction=toUniversity',
				)
			).status,
		).toBe(403);
		const { get } = setup();
		expect((await get('/api/v1/bus/legs?direction=toUniversity')).status).toBe(400);
		expect((await get('/api/v1/bus/legs?stopId=14013&direction=up')).status).toBe(400);
		expect((await get('/api/v1/bus/legs?stopId=14013&direction=toUniversity&day=x')).status).toBe(
			400,
		);
	});

	it('未来大そのもの、一覧にない停留所、バスの機能を使わない設定では 404', async () => {
		const { get } = setup();
		expect((await get('/api/v1/bus/legs?stopId=14023&direction=toUniversity')).status).toBe(404);
		expect((await get('/api/v1/bus/legs?stopId=99999&direction=toUniversity')).status).toBe(404);
		const disabled = setup({ disabled: true });
		expect(
			(await disabled.get('/api/v1/bus/legs?stopId=14013&direction=toUniversity')).status,
		).toBe(404);
	});
});
