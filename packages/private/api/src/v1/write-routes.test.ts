import { type AccessTokenScope, type Database } from '@funmary/db';
import { useTestDatabase } from '@funmary/db/testing';
import { describe, expect, it } from 'vitest';
import { createTestApiDeps } from '../testing.ts';
import { createV1Routes } from './routes.ts';

let database: Database;
useTestDatabase('funmary-v1-write-routes-', (db) => (database = db));

const NOW = new Date();
const BODY = {
	title: '歯医者',
	startDate: '2026-10-20',
	time: { kind: 'time', start: '10:00', end: '11:00' },
};

function setup() {
	const src = createTestApiDeps(database);
	const app = createV1Routes(src);
	const user = (sub: string) =>
		src.users.createUser(
			{ googleSub: sub, email: `${sub}@fun.ac.jp`, name: null, role: 'user' },
			NOW,
		);
	const tokenFor = (userId: string, scopes: AccessTokenScope[], name = '手元のスクリプト') =>
		src.accessTokens.issue(userId, { name, scopes }, new Date(NOW.getTime() + 86_400_000), NOW);
	const call = (token: string, method: string, path: string, body?: unknown) =>
		app.request(path, {
			method,
			headers: {
				Authorization: `Bearer ${token}`,
				...(body === undefined ? {} : { 'content-type': 'application/json' }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	return { src, user, tokenFor, call };
}

describe('予定の書き込み (REST)', () => {
	it('write:events のトークンで足せて、履歴にトークンの名前が残る', async () => {
		const { src, user, tokenFor, call } = setup();
		const a = user('a');
		const token = tokenFor(a, ['write:events'], '手元の Claude Desktop');

		const res = await call(token, 'POST', '/api/v1/events', BODY);

		expect(res.status).toBe(201);
		expect(await res.json()).toMatchObject({
			id: expect.any(Number) as number,
			title: '歯医者',
			repeat: null,
		});
		expect(src.activity.listRecent(a)).toMatchObject([
			{
				action: 'event.create',
				tokenName: '手元の Claude Desktop',
				summary: '予定「歯医者」を足した',
			},
		]);
	});

	it('読み取りだけのトークンでは、書き込めない (403)', async () => {
		const { src, user, tokenFor, call } = setup();
		const a = user('a');
		const token = tokenFor(a, ['read:lessons', 'read:changes', 'read:notifications']);

		const res = await call(token, 'POST', '/api/v1/events', BODY);

		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({ error: 'insufficient_scope' });
		expect(src.userEvents.listByOwner(a)).toEqual([]);
	});

	it('公開範囲を送ると 400。誤った入力も、画面と同じ文で 400', async () => {
		const { user, tokenFor, call } = setup();
		const token = tokenFor(user('a'), ['write:events']);

		expect(
			(await call(token, 'POST', '/api/v1/events', { ...BODY, visibility: 'public' })).status,
		).toBe(400);
		const invalid = await call(token, 'POST', '/api/v1/events', { ...BODY, title: '' });
		expect(invalid.status).toBe(400);
		expect(await invalid.json()).toEqual({
			error: 'invalid_request',
			message: '予定の名前を入れてください。',
		});
	});

	it('直せる。ほかの人の予定は 404 で、直せない', async () => {
		const { user, tokenFor, call } = setup();
		const a = user('a');
		const b = user('b');
		const tokenA = tokenFor(a, ['write:events']);
		const tokenB = tokenFor(b, ['write:events']);
		const created = (await (await call(tokenA, 'POST', '/api/v1/events', BODY)).json()) as {
			id: number;
		};

		const updated = await call(tokenA, 'PUT', `/api/v1/events/${created.id}`, {
			...BODY,
			title: '歯医者 (変更)',
		});
		expect(updated.status).toBe(200);
		expect(await updated.json()).toMatchObject({ id: created.id, title: '歯医者 (変更)' });
		expect((await call(tokenB, 'PUT', `/api/v1/events/${created.id}`, BODY)).status).toBe(404);
	});

	it('消せる。消した予定は、もう一度消すと 404', async () => {
		const { user, tokenFor, call } = setup();
		const token = tokenFor(user('a'), ['write:events']);
		const created = (await (await call(token, 'POST', '/api/v1/events', BODY)).json()) as {
			id: number;
		};

		expect((await call(token, 'DELETE', `/api/v1/events/${created.id}`)).status).toBe(204);
		expect((await call(token, 'DELETE', `/api/v1/events/${created.id}`)).status).toBe(404);
	});

	it('予定を 1 件読める。読んだ形のまま送り直せる (read:lessons)', async () => {
		const { user, tokenFor, call } = setup();
		const a = user('a');
		const writer = tokenFor(a, ['write:events']);
		const reader = tokenFor(a, ['read:lessons']);
		const created = (await (await call(writer, 'POST', '/api/v1/events', BODY)).json()) as {
			id: number;
		};

		const res = await call(reader, 'GET', `/api/v1/events/${created.id}`);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(created);
		expect((await call(reader, 'GET', '/api/v1/events/99999')).status).toBe(404);
	});

	it('書き込みは、1 分あたり 20 回まで (429)', async () => {
		const { user, tokenFor, call } = setup();
		const token = tokenFor(user('a'), ['write:events']);

		for (let i = 0; i < 20; i++) {
			expect((await call(token, 'POST', '/api/v1/events', BODY)).status).toBe(201);
		}
		expect((await call(token, 'POST', '/api/v1/events', BODY)).status).toBe(429);
	});
});

describe('通知の既読 (REST)', () => {
	function notified() {
		const ctx = setup();
		const a = ctx.user('a');
		const [id] = ctx.src.notifications.insertMany(
			[
				{
					userId: a,
					kind: 'notice',
					title: 'お知らせ',
					body: null,
					link: null,
					subjectId: null,
					dedupeKey: 'x',
				},
			],
			NOW,
		);
		return { ...ctx, a, id: id as number };
	}

	it('1 件を既読にできる。read:notifications だけでは、できない', async () => {
		const { tokenFor, call, a, id } = notified();

		expect(
			(await call(tokenFor(a, ['read:notifications']), 'POST', `/api/v1/notifications/${id}/read`))
				.status,
		).toBe(403);
		const res = await call(
			tokenFor(a, ['write:notifications']),
			'POST',
			`/api/v1/notifications/${id}/read`,
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ id, readAt: expect.any(String) as string });
	});

	it('すべてを既読にでき、件数を返す', async () => {
		const { tokenFor, call, a } = notified();

		const res = await call(
			tokenFor(a, ['write:notifications']),
			'POST',
			'/api/v1/notifications/read',
		);

		expect(await res.json()).toEqual({ count: 1 });
	});
});
