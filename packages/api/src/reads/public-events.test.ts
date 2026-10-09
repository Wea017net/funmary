import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createAuthStore,
	createSourceHealthStore,
	createUserEventStore,
	openDatabase,
	type Database,
	type UserEventInput,
} from '@funmary/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDataStatus, listUserEventOccurrences } from './public-events.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-public-events-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const T0 = new Date('2026-10-01T00:00:00Z');

const input = (overrides: Partial<UserEventInput> = {}): UserEventInput => ({
	title: '架空のサークル',
	location: '架空の部室',
	notes: '持ち主だけのメモ',
	startDate: '2026-10-05',
	endDate: '2026-10-05',
	time: { kind: 'time', start: '18:00', end: '19:30' },
	rrule: null,
	excludedDates: [],
	visibility: 'public',
	...overrides,
});

function setup() {
	const auth = createAuthStore(database);
	const alice = auth.createUser(
		{ googleSub: 'a', email: 'a@fun.ac.jp', name: null, role: 'user' },
		T0,
	);
	const bob = auth.createUser(
		{ googleSub: 'b', email: 'b@fun.ac.jp', name: null, role: 'user' },
		T0,
	);
	return {
		userEvents: createUserEventStore(database),
		alice: { id: alice, email: 'a@fun.ac.jp' },
		bob: { id: bob, email: 'b@fun.ac.jp' },
	};
}

describe('listUserEventOccurrences', () => {
	it('自分の予定を、期間に重なる回ごとに返す。繰り返しも展開する', () => {
		const { userEvents, alice } = setup();
		userEvents.create(alice.id, input(), T0);
		userEvents.create(
			alice.id,
			input({
				title: '毎週の集まり',
				rrule: 'FREQ=WEEKLY;BYDAY=WE',
				startDate: '2026-10-07',
				endDate: '2026-10-07',
			}),
			T0,
		);

		const events = listUserEventOccurrences({ userEvents }, alice, {
			start: '2026-10-05',
			end: '2026-10-14',
		});

		expect(events.map((event) => `${event.startDate} ${event.title}`)).toEqual([
			'2026-10-05 架空のサークル',
			'2026-10-07 毎週の集まり',
			'2026-10-14 毎週の集まり',
		]);
		expect(events[0]).toMatchObject({
			allDay: false,
			start: '18:00',
			end: '19:30',
			location: '架空の部室',
			notes: '持ち主だけのメモ',
			added: false,
		});
	});

	it('時間割に加えたほかの人の予定は added で、メモは見せない', () => {
		const { userEvents, alice, bob } = setup();
		const id = userEvents.create(alice.id, input(), T0);
		userEvents.subscribe(bob, id, T0);

		const forBob = listUserEventOccurrences({ userEvents }, bob, {
			start: '2026-10-05',
			end: '2026-10-05',
		});

		expect(forBob).toHaveLength(1);
		expect(forBob[0]).toMatchObject({ added: true, notes: null, title: '架空のサークル' });
	});

	it('加えていない予定と、ほかの人の予定は含めない', () => {
		const { userEvents, alice, bob } = setup();
		userEvents.create(alice.id, input(), T0);

		expect(
			listUserEventOccurrences({ userEvents }, bob, { start: '2026-10-05', end: '2026-10-05' }),
		).toEqual([]);
	});

	it('時限で決めた予定は、時限の範囲を返す', () => {
		const { userEvents, alice } = setup();
		userEvents.create(alice.id, input({ time: { kind: 'period', from: 2, to: 3 } }), T0);

		const [event] = listUserEventOccurrences({ userEvents }, alice, {
			start: '2026-10-05',
			end: '2026-10-05',
		});

		expect(event).toMatchObject({ allDay: false, periods: { from: 2, to: 3 } });
	});
});

describe('getDataStatus', () => {
	const now = new Date('2026-10-05T00:00:00Z');

	it('一度も取れていなければ、古い', () => {
		const sourceHealth = createSourceHealthStore(database);

		expect(getDataStatus({ sourceHealth }, now)).toEqual({
			timetable: { lastSuccessAt: null, stale: true },
		});
	});

	it('最近取れていれば古くなく、取れた日時を返す', () => {
		const sourceHealth = createSourceHealthStore(database);
		sourceHealth.save('portal', {
			...sourceHealth.load('portal'),
			lastSuccessAt: new Date('2026-10-04T23:00:00Z'),
		});

		expect(getDataStatus({ sourceHealth }, now)).toEqual({
			timetable: { lastSuccessAt: '2026-10-04T23:00:00.000Z', stale: false },
		});
	});

	it('長く取れていなければ、古い', () => {
		const sourceHealth = createSourceHealthStore(database);
		sourceHealth.save('portal', {
			...sourceHealth.load('portal'),
			lastSuccessAt: new Date('2026-09-20T00:00:00Z'),
		});

		expect(getDataStatus({ sourceHealth }, now).timetable.stale).toBe(true);
	});
});
