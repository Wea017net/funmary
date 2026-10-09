import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAccessTokenStore } from './access-token-store.ts';
import { createAuthStore } from './auth-store.ts';
import { openDatabase, type Database } from './database.ts';
import { accessTokens } from './schema.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-access-token-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const t0 = new Date('2026-10-01T00:00:00Z');
const later = (ms: number) => new Date(t0.getTime() + ms);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const expiresAt = later(90 * DAY);

function addUser(email: string) {
	const auth = createAuthStore(database);
	return { auth, id: auth.createUser({ googleSub: email, email, name: null, role: 'user' }, t0) };
}

describe('個人用アクセストークン', () => {
	it('発行したトークンで持ち主と範囲が分かり、DB にはトークンそのものを残さない', () => {
		const { id } = addUser('a@fun.ac.jp');
		const store = createAccessTokenStore(database);
		const token = store.issue(
			id,
			{ name: '手元のスクリプト', scopes: ['read:lessons'] },
			expiresAt,
			t0,
		);
		expect(token).toMatch(/^fmy_[\w-]{43}$/);
		expect(store.findOwner(token, t0)).toMatchObject({ userId: id, scopes: ['read:lessons'] });

		const rows = database.db.select().from(accessTokens).all();
		expect(rows.map((row) => row.tokenHash)).not.toContain(token);
	});

	it('1 人が複数のトークンを同時に持てる', () => {
		const { id } = addUser('a@fun.ac.jp');
		const store = createAccessTokenStore(database);
		const first = store.issue(id, { name: '1 つ目', scopes: ['read:lessons'] }, expiresAt, t0);
		const second = store.issue(id, { name: '2 つ目', scopes: ['read:changes'] }, expiresAt, t0);
		expect(store.findOwner(first, t0)).toMatchObject({ userId: id });
		expect(store.findOwner(second, t0)).toMatchObject({ userId: id });
		expect(store.list(id, t0).map((row) => row.name)).toEqual(['2 つ目', '1 つ目']);
	});

	it('期限が切れたトークンでは見つからない', () => {
		const { id } = addUser('a@fun.ac.jp');
		const store = createAccessTokenStore(database);
		const token = store.issue(id, { name: '短命', scopes: ['read:lessons'] }, later(HOUR), t0);
		expect(store.findOwner(token, later(30 * 60 * 1000))).toMatchObject({ userId: id });
		expect(store.findOwner(token, later(2 * HOUR))).toBeNull();
	});

	it('無効にしたトークンでは見つからず、一覧からも消える。本人以外は無効にできない', () => {
		const a = addUser('a@fun.ac.jp');
		const b = addUser('b@fun.ac.jp');
		const store = createAccessTokenStore(database);
		const token = store.issue(a.id, { name: '消す', scopes: ['read:lessons'] }, expiresAt, t0);
		const owner = store.findOwner(token, t0);
		if (!owner) throw new Error('見つかりません');

		expect(store.revoke(b.id, owner.id, later(HOUR))).toBe(false);
		expect(store.findOwner(token, later(HOUR))).toMatchObject({ userId: a.id });

		expect(store.revoke(a.id, owner.id, later(2 * HOUR))).toBe(true);
		expect(store.findOwner(token, later(2 * HOUR))).toBeNull();
		expect(store.list(a.id, later(2 * HOUR))).toEqual([]);
	});

	it('停止した利用者のトークンでは見つからない', () => {
		const { auth, id } = addUser('a@fun.ac.jp');
		const store = createAccessTokenStore(database);
		const token = store.issue(id, { name: '止める', scopes: ['read:lessons'] }, expiresAt, t0);
		auth.setStatus(id, 'suspended');
		expect(store.findOwner(token, t0)).toBeNull();
	});

	it('使った日時は、1 時間に 1 回だけ書き込む', () => {
		const { id } = addUser('a@fun.ac.jp');
		const store = createAccessTokenStore(database);
		const token = store.issue(id, { name: '使う', scopes: ['read:lessons'] }, expiresAt, t0);
		const owner = store.findOwner(token, t0);
		if (!owner) throw new Error('見つかりません');

		store.markUsed(owner.id, later(10 * 60 * 1000));
		expect(store.list(id, t0)[0]?.lastUsedAt).toEqual(later(10 * 60 * 1000));
		store.markUsed(owner.id, later(30 * 60 * 1000));
		expect(store.list(id, t0)[0]?.lastUsedAt).toEqual(later(10 * 60 * 1000));
		store.markUsed(owner.id, later(2 * HOUR));
		expect(store.list(id, t0)[0]?.lastUsedAt).toEqual(later(2 * HOUR));
	});

	it('ほかの人のトークンは一覧に出ない', () => {
		const a = addUser('a@fun.ac.jp');
		const b = addUser('b@fun.ac.jp');
		const store = createAccessTokenStore(database);
		store.issue(a.id, { name: 'A のもの', scopes: ['read:lessons'] }, expiresAt, t0);
		store.issue(b.id, { name: 'B のもの', scopes: ['read:lessons'] }, expiresAt, t0);
		expect(store.list(a.id, t0).map((row) => row.name)).toEqual(['A のもの']);
	});
});

describe('トークンの持ち主の利用規約への同意', () => {
	it('持ち主が同意した版を、findOwner が返す', () => {
		const { auth, id } = addUser('a@fun.ac.jp');
		const store = createAccessTokenStore(database);
		const token = store.issue(id, { name: 'test', scopes: ['read:lessons'] }, expiresAt, t0);

		expect(store.findOwner(token, t0)?.termsAcceptedVersion).toBeNull();

		auth.acceptTerms(id, '2026-10-03', t0);
		expect(store.findOwner(token, t0)?.termsAcceptedVersion).toBe('2026-10-03');
	});
});
