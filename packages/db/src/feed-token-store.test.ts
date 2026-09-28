import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthStore } from './auth-store.ts';
import { openDatabase, type Database } from './database.ts';
import { createFeedTokenStore } from './feed-token-store.ts';
import { feedTokens } from './schema.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-feed-token-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const t0 = new Date('2026-10-01T00:00:00Z');
const later = (ms: number) => new Date(t0.getTime() + ms);
const HOUR = 60 * 60 * 1000;

function addUser(email: string) {
	const auth = createAuthStore(database);
	return { auth, id: auth.createUser({ googleSub: email, email, name: null, role: 'user' }, t0) };
}

describe('ICS とフィードの URL のトークン', () => {
	it('発行したトークンで持ち主が分かり、DB にはトークンそのものを残さない', () => {
		const { id } = addUser('a@fun.ac.jp');
		const store = createFeedTokenStore(database);
		expect(store.current(id, 'calendar')).toBeNull();

		const token = store.issue(id, 'calendar', t0);
		expect(token).toMatch(/^[\w-]{43}$/);
		expect(store.findOwner('calendar', token)).toMatchObject({ userId: id });
		expect(store.current(id, 'calendar')).toEqual({ createdAt: t0, lastUsedAt: null });
		const rows = database.db.select().from(feedTokens).all();
		expect(rows.map((row) => row.tokenHash)).not.toContain(token);
	});

	it('種類が違うトークンや、知らないトークンでは見つからない', () => {
		const { id } = addUser('a@fun.ac.jp');
		const store = createFeedTokenStore(database);
		const token = store.issue(id, 'calendar', t0);
		expect(store.findOwner('feed', token)).toBeNull();
		expect(store.findOwner('calendar', 'unknown')).toBeNull();
	});

	it('再発行すると前のトークンは使えなくなり、無効にするとどれも使えない', () => {
		const { id } = addUser('a@fun.ac.jp');
		const store = createFeedTokenStore(database);
		const first = store.issue(id, 'calendar', t0);
		const second = store.issue(id, 'calendar', later(HOUR));
		expect(store.findOwner('calendar', first)).toBeNull();
		expect(store.findOwner('calendar', second)).toMatchObject({ userId: id });
		expect(store.current(id, 'calendar')?.createdAt).toEqual(later(HOUR));

		expect(store.revoke(id, 'calendar', later(2 * HOUR))).toBe(true);
		expect(store.findOwner('calendar', second)).toBeNull();
		expect(store.current(id, 'calendar')).toBeNull();
		expect(store.revoke(id, 'calendar', later(3 * HOUR))).toBe(false);
	});

	it('ほかの人のトークンは、再発行や無効化で消えない', () => {
		const a = addUser('a@fun.ac.jp');
		const b = addUser('b@fun.ac.jp');
		const store = createFeedTokenStore(database);
		const tokenA = store.issue(a.id, 'calendar', t0);
		store.issue(b.id, 'calendar', t0);
		store.revoke(b.id, 'calendar', later(HOUR));
		expect(store.findOwner('calendar', tokenA)).toMatchObject({ userId: a.id });
	});

	it('停止した利用者のトークンでは見つからない', () => {
		const { auth, id } = addUser('a@fun.ac.jp');
		const store = createFeedTokenStore(database);
		const token = store.issue(id, 'calendar', t0);
		auth.setStatus(id, 'suspended');
		expect(store.findOwner('calendar', token)).toBeNull();
	});

	it('使った日時は、1 時間に 1 回だけ書き込む', () => {
		const { id } = addUser('a@fun.ac.jp');
		const store = createFeedTokenStore(database);
		const token = store.issue(id, 'calendar', t0);
		const owner = store.findOwner('calendar', token);
		if (!owner) throw new Error('見つかりません');

		store.markUsed(owner.id, later(10 * 60 * 1000));
		expect(store.current(id, 'calendar')?.lastUsedAt).toEqual(later(10 * 60 * 1000));
		store.markUsed(owner.id, later(30 * 60 * 1000));
		expect(store.current(id, 'calendar')?.lastUsedAt).toEqual(later(10 * 60 * 1000));
		store.markUsed(owner.id, later(2 * HOUR));
		expect(store.current(id, 'calendar')?.lastUsedAt).toEqual(later(2 * HOUR));
	});
});
