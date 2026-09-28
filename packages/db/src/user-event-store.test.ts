import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthStore } from './auth-store.ts';
import { openDatabase, type Database } from './database.ts';
import { createUserEventStore, type UserEventInput } from './user-event-store.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-user-events-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const T0 = new Date('2026-10-01T00:00:00Z');
const T1 = new Date('2026-10-02T00:00:00Z');

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
	return { store: createUserEventStore(database), alice, bob, auth };
}

const input = (overrides: Partial<UserEventInput> = {}): UserEventInput => ({
	title: '架空のサークル',
	location: '架空の部室',
	notes: null,
	startDate: '2026-10-05',
	endDate: '2026-10-05',
	time: { kind: 'time', start: '18:00', end: '19:30' },
	rrule: null,
	excludedDates: [],
	...overrides,
});

describe('UserEventStore', () => {
	it('予定を足して、持ち主が読み戻せる。時間の 3 つの種類を、そのまま保存できる', () => {
		const { store, alice } = setup();
		const timed = store.create(alice, input(), T0);
		const period = store.create(alice, input({ time: { kind: 'period', from: 2, to: 3 } }), T0);
		const allDay = store.create(
			alice,
			input({
				endDate: '2026-10-08',
				time: { kind: 'allDay' },
				rrule: 'FREQ=WEEKLY;BYDAY=MO',
				excludedDates: ['2026-10-12'],
			}),
			T0,
		);
		expect(store.get(timed, alice)).toEqual({ id: timed, ...input() });
		expect(store.get(period, alice)?.time).toEqual({ kind: 'period', from: 2, to: 3 });
		expect(store.get(allDay, alice)).toMatchObject({
			endDate: '2026-10-08',
			time: { kind: 'allDay' },
			rrule: 'FREQ=WEEKLY;BYDAY=MO',
			excludedDates: ['2026-10-12'],
		});
	});

	it('ほかの人の予定は、読めず、直せず、消せない', () => {
		const { store, alice, bob } = setup();
		const id = store.create(alice, input(), T0);
		expect(store.get(id, bob)).toBeNull();
		expect(store.update(id, bob, input({ title: '乗っ取り' }), T1)).toBe(false);
		expect(store.delete(id, bob)).toBe(false);
		expect(store.get(id, alice)?.title).toBe('架空のサークル');
		expect(store.listByOwner(bob)).toEqual([]);
	});

	it('持ち主は、予定を直し、消せる', () => {
		const { store, alice } = setup();
		const id = store.create(alice, input(), T0);
		expect(store.update(id, alice, input({ title: '改名', time: { kind: 'allDay' } }), T1)).toBe(
			true,
		);
		expect(store.get(id, alice)).toMatchObject({ title: '改名', time: { kind: 'allDay' } });
		expect(store.delete(id, alice)).toBe(true);
		expect(store.get(id, alice)).toBeNull();
		expect(store.delete(id, alice)).toBe(false);
	});

	it('一覧は、始まりの日の順に返す', () => {
		const { store, alice } = setup();
		store.create(alice, input({ title: 'B', startDate: '2026-11-01', endDate: '2026-11-01' }), T0);
		store.create(alice, input({ title: 'A', startDate: '2026-10-01', endDate: '2026-10-01' }), T0);
		expect(store.listByOwner(alice).map((event) => event.title)).toEqual(['A', 'B']);
	});

	it('利用者が退会 (削除) されたら、その人の予定も消える', () => {
		const { store, alice, auth } = setup();
		store.create(alice, input(), T0);
		database.sqlite.prepare('DELETE FROM users WHERE id = ?').run(alice);
		expect(auth).toBeDefined();
		expect(store.listByOwner(alice)).toEqual([]);
	});
});
