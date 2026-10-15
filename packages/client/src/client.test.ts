import { describe, expect, it, vi } from 'vitest';
import { createFunmaryClient, FunmaryApiError } from './index.ts';

const BASE = 'https://funmary.example.com';

type Call = { url: string; init: RequestInit };

const urlOf = (input: string | URL | Request) =>
	typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

function json(body: unknown, init: ResponseInit = {}) {
	return new Response(JSON.stringify(body), {
		...init,
		headers: { 'content-type': 'application/json', ...init.headers },
	});
}

function setup(...responses: (Response | Error)[]) {
	const calls: Call[] = [];
	const queue = [...responses];
	const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: urlOf(input), init: init ?? {} });
		const next = queue.shift() ?? json({});
		return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
	});
	const sleeps: number[] = [];
	const client = createFunmaryClient({
		baseURL: BASE,
		token: 'fmy_secret',
		fetch: fetchMock,
		sleep: (ms) => {
			sleeps.push(ms);
			return Promise.resolve();
		},
	});
	return { client, calls, sleeps, fetchMock };
}

const headerOf = (call: Call | undefined, name: string) =>
	new Headers(call?.init.headers).get(name);

describe('createFunmaryClient', () => {
	it('トークンを Bearer で送り、基準の URL と道を結ぶ。末尾のスラッシュは二重にしない', async () => {
		const { client, calls } = setup(json({ id: 'u1', email: 'a@fun.ac.jp', scopes: [] }));
		const withSlash = createFunmaryClient({
			baseURL: `${BASE}/`,
			token: 'fmy_secret',
			fetch: (input: string | URL | Request, init?: RequestInit) => {
				calls.push({ url: urlOf(input), init: init ?? {} });
				return Promise.resolve(json({ id: 'u1', email: 'a@fun.ac.jp', scopes: [] }));
			},
		});
		await withSlash.me();
		await client.me();
		expect(calls[0]?.url).toBe(`${BASE}/api/v1/me`);
		expect(headerOf(calls[0], 'authorization')).toBe('Bearer fmy_secret');
		expect(calls[1]?.url).toBe(`${BASE}/api/v1/me`);
	});

	it('範囲の指定を、クエリにして送る。未指定の項目は送らない', async () => {
		const { client, calls } = setup(json([]), json({ subjects: [], truncated: false }));
		await client.lessons({ start: '2026-10-01', end: '2026-10-07' });
		await client.subjects.search({ q: '線形', year: undefined });
		expect(calls[0]?.url).toBe(`${BASE}/api/v1/lessons?start=2026-10-01&end=2026-10-07`);
		expect(new URL(calls[1]!.url).searchParams.get('q')).toBe('線形');
		expect(new URL(calls[1]!.url).searchParams.has('year')).toBe(false);
	});

	it('パスの値は、URL に使える形にする', async () => {
		const { client, calls } = setup(json({}));
		await client.bus.stop('a/b', { generation: 20261001 });
		expect(calls[0]?.url).toBe(`${BASE}/api/v1/bus/stops/a%2Fb?generation=20261001`);
	});

	it('書き込みは、JSON の本文と、メソッドで送る', async () => {
		const { client, calls } = setup(
			json({ id: 1 }, { status: 201 }),
			new Response(null, { status: 204 }),
		);
		await client.events.create({
			title: '歯医者',
			startDate: '2026-10-20',
			time: { kind: 'allDay' },
		});
		await client.events.delete(1);
		expect(calls[0]?.init.method).toBe('POST');
		const sent = calls[0]?.init.body;
		expect(typeof sent === 'string' ? JSON.parse(sent) : null).toMatchObject({ title: '歯医者' });
		expect(calls[1]?.init.method).toBe('DELETE');
	});

	it('204 は、本文なしで返す', async () => {
		const { client } = setup(new Response(null, { status: 204 }));
		await expect(client.events.delete(1)).resolves.toBeUndefined();
	});

	it('4xx は FunmaryApiError にし、状態、誤りの種類、文を持たせる。トークンは含めない', async () => {
		const { client } = setup(
			json({ error: 'not_found', message: '予定が見つかりません' }, { status: 404 }),
		);
		const error = await client.events.get(9).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(FunmaryApiError);
		expect(error).toMatchObject({
			status: 404,
			code: 'not_found',
			message: '予定が見つかりません',
		});
		expect(JSON.stringify(error)).not.toContain('fmy_secret');
	});

	it('本文が JSON でない誤りも、状態から FunmaryApiError にする', async () => {
		const { client } = setup(new Response('bad gateway', { status: 502 }));
		await expect(client.me()).rejects.toMatchObject({ status: 502 });
	});

	it('429 では、Retry-After の秒数だけ待って、やり直す', async () => {
		const { client, calls, sleeps } = setup(
			json({ error: 'rate_limited' }, { status: 429, headers: { 'retry-after': '3' } }),
			json({ id: 'u1', email: 'a@fun.ac.jp', scopes: [] }),
		);
		await client.me();
		expect(calls).toHaveLength(2);
		expect(sleeps).toEqual([3000]);
	});

	it('429 が続けば、決めた回数でやめて、FunmaryApiError にする', async () => {
		const tooMany = () =>
			json({ error: 'rate_limited' }, { status: 429, headers: { 'retry-after': '1' } });
		const { client, calls } = setup(tooMany(), tooMany(), tooMany(), tooMany());
		await expect(client.me()).rejects.toMatchObject({ status: 429 });
		expect(calls).toHaveLength(3);
	});

	it('Retry-After がなければ、短い既定の時間だけ待つ。長すぎる指定は、上限で切る', async () => {
		const first = setup(json({}, { status: 429 }), json({}));
		await first.client.me();
		expect(first.sleeps[0]).toBeGreaterThan(0);
		const second = setup(json({}, { status: 429, headers: { 'retry-after': '3600' } }), json({}));
		await second.client.me();
		expect(second.sleeps[0]).toBeLessThanOrEqual(60_000);
	});

	it('5xx は、やり直さない (書き込みを二重にしないため)', async () => {
		const { client, calls } = setup(json({ error: 'x' }, { status: 500 }), json({}));
		await expect(client.me()).rejects.toMatchObject({ status: 500 });
		expect(calls).toHaveLength(1);
	});

	it('通信の失敗は、状態 0 の FunmaryApiError にする', async () => {
		const { client } = setup(new Error('connect ECONNREFUSED'));
		await expect(client.me()).rejects.toMatchObject({ status: 0, code: 'network_error' });
	});

	it('403 の同意待ちの本文 (consentUrl) を、誤りに残す', async () => {
		const { client } = setup(
			json(
				{ error: 'terms_not_accepted', message: '同意が必要です', consentUrl: `${BASE}/consent` },
				{ status: 403 },
			),
		);
		await expect(client.me()).rejects.toMatchObject({
			status: 403,
			code: 'terms_not_accepted',
			body: { consentUrl: `${BASE}/consent` },
		});
	});
});
