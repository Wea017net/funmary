import type { AccessTokenOwner } from '@funmary/db';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { requireScope, v1Auth, type V1AuthVariables } from './auth.ts';

function appWith(owner: AccessTokenOwner | null) {
	const app = new Hono<{ Variables: V1AuthVariables }>();
	app.use('/*', v1Auth({ accessTokens: { findOwner: () => owner, markUsed: () => undefined } }));
	app.get('/lessons', requireScope('read:lessons'), (c) => c.json(c.get('tokenOwner')));
	return app;
}

describe('v1Auth', () => {
	it('Authorization ヘッダがなければ 401', async () => {
		const app = appWith(null);
		const res = await app.request('/lessons');
		expect(res.status).toBe(401);
	});

	it('Bearer でないヘッダは 401', async () => {
		const app = appWith(null);
		const res = await app.request('/lessons', { headers: { Authorization: 'Basic abc' } });
		expect(res.status).toBe(401);
	});

	it('知らない、期限切れのトークンは 401', async () => {
		const app = appWith(null);
		const res = await app.request('/lessons', { headers: { Authorization: 'Bearer fmy_x' } });
		expect(res.status).toBe(401);
	});

	it('有効なトークンなら、持ち主を c.var.tokenOwner に置く', async () => {
		const app = appWith({ id: 1, userId: 'u1', scopes: ['read:lessons'] });
		const res = await app.request('/lessons', { headers: { Authorization: 'Bearer fmy_x' } });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ userId: 'u1', scopes: ['read:lessons'] });
	});
});

describe('requireScope', () => {
	it('範囲が足りなければ 403', async () => {
		const app = appWith({ id: 1, userId: 'u1', scopes: ['read:changes'] });
		const res = await app.request('/lessons', { headers: { Authorization: 'Bearer fmy_x' } });
		expect(res.status).toBe(403);
	});
});
