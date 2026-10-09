import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAccessTokenStore } from './access-token-store.ts';
import { createAuthStore } from './auth-store.ts';
import { openDatabase, type Database } from './database.ts';
import {
	createOAuthStore,
	MAX_OAUTH_CLIENTS,
	OAUTH_ACCESS_TOKEN_LIFETIME_MS,
} from './oauth-store.ts';
import { oauthClients, oauthRefreshTokens } from './schema.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-oauth-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const t0 = new Date('2026-10-01T00:00:00Z');
const later = (ms: number) => new Date(t0.getTime() + ms);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function setup() {
	const auth = createAuthStore(database);
	const userId = auth.createUser(
		{ googleSub: 'a', email: 'a@fun.ac.jp', name: null, role: 'user' },
		t0,
	);
	const accessTokens = createAccessTokenStore(database);
	const oauth = createOAuthStore(database, accessTokens);
	const client = oauth.registerClient(
		{ name: 'Claude', redirectUris: ['https://claude.ai/api/mcp/auth_callback'] },
		t0,
	);
	if (!client) throw new Error('登録できませんでした');
	return { auth, userId, accessTokens, oauth, client };
}

const codeInput = (clientId: string, userId: string) => ({
	clientId,
	userId,
	redirectUri: 'https://claude.ai/api/mcp/auth_callback',
	codeChallenge: 'challenge',
	scopes: ['read:lessons' as const],
});

describe('クライアントの登録', () => {
	it('登録すると、client_id で引ける', () => {
		const { oauth, client } = setup();

		expect(oauth.findClient(client.id)).toEqual({
			id: client.id,
			name: 'Claude',
			redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
		});
		expect(oauth.findClient('unknown')).toBeNull();
	});

	it('上限に達すると、登録できない', () => {
		const { oauth } = setup();
		database.db
			.insert(oauthClients)
			.values(
				Array.from({ length: MAX_OAUTH_CLIENTS }, (_, i) => ({
					id: `bulk-${i}`,
					name: 'x',
					redirectUris: [],
					createdAt: t0,
				})),
			)
			.run();

		expect(oauth.registerClient({ name: 'もう 1 つ', redirectUris: [] }, t0)).toBeNull();
	});

	it('使われないまま 7 日たった登録は、次の登録のときに片付く', () => {
		const { oauth, client } = setup();

		oauth.registerClient({ name: '次', redirectUris: [] }, later(8 * DAY));

		expect(oauth.findClient(client.id)).toBeNull();
	});

	it('トークンを持つ登録は、古くても残る', () => {
		const { oauth, client, userId } = setup();
		oauth.issueTokens({ clientId: client.id, userId, scopes: ['read:lessons'] }, t0);

		oauth.registerClient({ name: '次', redirectUris: [] }, later(30 * DAY));

		expect(oauth.findClient(client.id)).not.toBeNull();
	});
});

describe('認可コード', () => {
	it('引き換えると本人と登録の内容が返り、2 回目は使えない', () => {
		const { oauth, client, userId } = setup();
		const code = oauth.createCode(codeInput(client.id, userId), t0);

		expect(oauth.consumeCode(code, later(MINUTE))).toEqual({
			clientId: client.id,
			userId,
			redirectUri: 'https://claude.ai/api/mcp/auth_callback',
			codeChallenge: 'challenge',
			scopes: ['read:lessons'],
		});
		expect(oauth.consumeCode(code, later(MINUTE))).toBeNull();
	});

	it('10 分たつと使えない', () => {
		const { oauth, client, userId } = setup();
		const code = oauth.createCode(codeInput(client.id, userId), t0);

		expect(oauth.consumeCode(code, later(10 * MINUTE))).toBeNull();
	});

	it('知らないコードは使えない', () => {
		const { oauth } = setup();

		expect(oauth.consumeCode('unknown', t0)).toBeNull();
	});
});

describe('トークンの発行', () => {
	it('発行したアクセストークンで、持ち主と範囲が分かる。寿命は 1 時間', () => {
		const { oauth, accessTokens, client, userId } = setup();

		const tokens = oauth.issueTokens(
			{ clientId: client.id, userId, scopes: ['read:lessons', 'read:changes'] },
			t0,
		);

		expect(tokens.accessToken).toMatch(/^fmy_/);
		expect(tokens.refreshToken).toMatch(/^fmr_/);
		expect(tokens.expiresInSeconds).toBe(OAUTH_ACCESS_TOKEN_LIFETIME_MS / 1000);
		expect(accessTokens.findOwner(tokens.accessToken, later(MINUTE))).toMatchObject({
			userId,
			scopes: ['read:lessons', 'read:changes'],
		});
		expect(accessTokens.findOwner(tokens.accessToken, later(HOUR))).toBeNull();
		expect(accessTokens.list(userId, t0).map((token) => token.name)).toEqual(['Claude (OAuth)']);
	});
});

describe('リフレッシュ', () => {
	it('新しいトークンに替わり、古いアクセストークンは使えなくなる', () => {
		const { oauth, accessTokens, client, userId } = setup();
		const first = oauth.issueTokens({ clientId: client.id, userId, scopes: ['read:lessons'] }, t0);

		const result = oauth.refresh(first.refreshToken, client.id, later(2 * HOUR));

		if (result.kind !== 'issued') throw new Error('替わるはず');
		expect(result.tokens.accessToken).not.toBe(first.accessToken);
		expect(result.tokens.refreshToken).not.toBe(first.refreshToken);
		expect(result.tokens.scopes).toEqual(['read:lessons']);
		expect(accessTokens.findOwner(result.tokens.accessToken, later(2 * HOUR))).toMatchObject({
			userId,
		});
		expect(accessTokens.list(userId, later(2 * HOUR))).toHaveLength(1);
	});

	it('替えたあとの古いリフレッシュトークンがまた来たら、系列ごと使えなくする', () => {
		const { oauth, accessTokens, client, userId } = setup();
		const first = oauth.issueTokens({ clientId: client.id, userId, scopes: ['read:lessons'] }, t0);
		const second = oauth.refresh(first.refreshToken, client.id, later(2 * HOUR));
		if (second.kind !== 'issued') throw new Error('替わるはず');

		expect(oauth.refresh(first.refreshToken, client.id, later(3 * HOUR))).toEqual({
			kind: 'invalid',
		});

		expect(oauth.refresh(second.tokens.refreshToken, client.id, later(3 * HOUR))).toEqual({
			kind: 'invalid',
		});
		expect(accessTokens.findOwner(second.tokens.accessToken, later(2 * HOUR))).toBeNull();
	});

	it('設定の画面でアクセストークンを無効にしていたら、リフレッシュもできない', () => {
		const { oauth, accessTokens, client, userId } = setup();
		const tokens = oauth.issueTokens({ clientId: client.id, userId, scopes: ['read:lessons'] }, t0);
		const [listed] = accessTokens.list(userId, t0);
		accessTokens.revoke(userId, listed?.id ?? 0, later(MINUTE));

		expect(oauth.refresh(tokens.refreshToken, client.id, later(2 * HOUR))).toEqual({
			kind: 'invalid',
		});
	});

	it('別のクライアントからは替えられない', () => {
		const { oauth, client, userId } = setup();
		const other = oauth.registerClient({ name: '別', redirectUris: [] }, t0);
		const tokens = oauth.issueTokens({ clientId: client.id, userId, scopes: ['read:lessons'] }, t0);

		expect(oauth.refresh(tokens.refreshToken, other?.id ?? '', later(HOUR))).toEqual({
			kind: 'invalid',
		});
	});

	it('90 日たつと使えない。知らないトークンも使えない', () => {
		const { oauth, client, userId } = setup();
		const tokens = oauth.issueTokens({ clientId: client.id, userId, scopes: ['read:lessons'] }, t0);

		expect(oauth.refresh(tokens.refreshToken, client.id, later(90 * DAY))).toEqual({
			kind: 'invalid',
		});
		expect(oauth.refresh('fmr_unknown', client.id, t0)).toEqual({ kind: 'invalid' });
	});

	it('リフレッシュトークンそのものは、DB に残さない', () => {
		const { oauth, client, userId } = setup();
		const tokens = oauth.issueTokens({ clientId: client.id, userId, scopes: ['read:lessons'] }, t0);

		const rows = database.db.select().from(oauthRefreshTokens).all();

		expect(JSON.stringify(rows)).not.toContain(tokens.refreshToken);
	});
});
