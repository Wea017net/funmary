import { describe, expect, it } from 'vitest';
import { AGREEMENT_VERSION, MARKER } from './agreement.ts';
import { createApp } from './app.ts';
import type { GitHubClient } from './github.ts';
import { signToken } from './signing.ts';
import type { AgreementStore } from './store.ts';

const ORIGIN = 'https://license.example.workers.dev';
const WEBHOOK_SECRET = 'webhook-secret';
const NOW = 1_800_000_000;

function setup(options: { agreed?: number[]; pulls?: { number: number; headSha: string }[] } = {}) {
	const calls: { method: string; args: unknown[] }[] = [];
	const agreed = new Set(options.agreed ?? []);
	const records: unknown[] = [];
	const github: GitHubClient = {
		installationToken: (repo) => {
			calls.push({ method: 'installationToken', args: [repo] });
			return Promise.resolve('installation-token');
		},
		openPullsBy: (_token, repo, userId) => {
			calls.push({ method: 'openPullsBy', args: [repo, userId] });
			return Promise.resolve((options.pulls ?? []).map((pull) => ({ ...pull, authorId: userId })));
		},
		setStatus: (_token, repo, sha, status) => {
			calls.push({ method: 'setStatus', args: [repo, sha, status] });
			return Promise.resolve();
		},
		upsertComment: (_token, repo, number, body, upsert) => {
			calls.push({ method: 'upsertComment', args: [repo, number, body, upsert] });
			return Promise.resolve();
		},
		exchangeCode: (code) => Promise.resolve(`user-token-for-${code}`),
		currentUser: () => Promise.resolve({ id: 42, login: 'student' }),
	};
	const store: AgreementStore = {
		hasAgreed: (userId, version) =>
			Promise.resolve(version === AGREEMENT_VERSION && agreed.has(userId)),
		record: (entry) => {
			records.push(entry);
			return Promise.resolve();
		},
	};
	const app = createApp({
		github,
		store,
		signingKey: 'signing-key',
		webhookSecret: WEBHOOK_SECRET,
		clientId: 'client-id',
		now: () => NOW,
	});
	return { app, calls, records };
}

async function sign(body: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(WEBHOOK_SECRET),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
	return `sha256=${Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function pullRequestEvent(overrides: { action?: string; association?: string; type?: string } = {}) {
	return JSON.stringify({
		action: overrides.action ?? 'opened',
		repository: { full_name: 'funmary-app/funmary' },
		pull_request: {
			number: 7,
			head: { sha: 'abc123' },
			author_association: overrides.association ?? 'FIRST_TIME_CONTRIBUTOR',
			user: { id: 42, login: 'student', type: overrides.type ?? 'User' },
		},
	});
}

async function webhook(app: ReturnType<typeof setup>['app'], body: string, event = 'pull_request') {
	return app.request(`${ORIGIN}/webhook`, {
		method: 'POST',
		body,
		headers: { 'X-GitHub-Event': event, 'X-Hub-Signature-256': await sign(body) },
	});
}

describe('Webhook', () => {
	it('署名が違えば、何もせずに 401 を返す', async () => {
		const { app, calls } = setup();
		const response = await app.request(`${ORIGIN}/webhook`, {
			method: 'POST',
			body: pullRequestEvent(),
			headers: { 'X-GitHub-Event': 'pull_request', 'X-Hub-Signature-256': 'sha256=00' },
		});
		expect(response.status).toBe(401);
		expect(calls).toEqual([]);
	});

	it('外部の人がまだ同意していなければ、案内のコメントを送り、検査を「待ち」にして、同意のページへつなぐ', async () => {
		const { app, calls } = setup();
		expect((await webhook(app, pullRequestEvent())).status).toBe(204);
		const comment = calls.find((call) => call.method === 'upsertComment');
		expect(comment?.args[2]).toContain(MARKER);
		expect(comment?.args[3]).toEqual({ create: true });
		expect(calls.find((call) => call.method === 'setStatus')?.args).toEqual([
			'funmary-app/funmary',
			'abc123',
			{
				state: 'pending',
				description: 'PR の作者の、ライセンスへの同意を待っています',
				targetUrl: `${ORIGIN}/agree?repo=funmary-app%2Ffunmary`,
			},
		]);
	});

	it('同意済みの人の PR は、検査を通し、案内のコメントがあれば確認の文に書き換える (なければ作らない)', async () => {
		const { app, calls } = setup({ agreed: [42] });
		await webhook(app, pullRequestEvent({ action: 'synchronize' }));
		expect(calls.find((call) => call.method === 'setStatus')?.args[2]).toMatchObject({
			state: 'success',
		});
		expect(calls.find((call) => call.method === 'upsertComment')?.args[3]).toEqual({
			create: false,
		});
	});

	it('メンバーと Bot の PR は、同意を求めずに検査を通す', async () => {
		for (const event of [
			pullRequestEvent({ association: 'MEMBER' }),
			pullRequestEvent({ type: 'Bot', association: 'NONE' }),
		]) {
			const { app, calls } = setup();
			await webhook(app, event);
			expect(calls.map((call) => call.method)).toEqual(['installationToken', 'setStatus']);
		}
	});

	it('見張らないアクションとイベントでは、何もしない', async () => {
		const { app, calls } = setup();
		await webhook(app, pullRequestEvent({ action: 'labeled' }));
		await webhook(app, '{}', 'ping');
		expect(calls).toEqual([]);
	});
});

describe('同意のページ', () => {
	it('リポジトリの指定が正しくなければ、400 を返す', async () => {
		const { app } = setup();
		expect((await app.request(`${ORIGIN}/agree?repo=../etc`)).status).toBe(400);
		expect((await app.request(`${ORIGIN}/agree?repo=funmary-app/funmary`)).status).toBe(200);
	});

	it('ログインでは、署名した state を付けて GitHub の認可の画面へ送り、戻ってきたら確認の画面を出す', async () => {
		const { app } = setup();
		const login = await app.request(`${ORIGIN}/login?repo=funmary-app/funmary`);
		expect(login.status).toBe(302);
		const location = new URL(login.headers.get('Location') ?? '');
		expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
		expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/callback`);

		const state = location.searchParams.get('state') ?? '';
		const callback = await app.request(`${ORIGIN}/callback?code=c1&state=${state}`);
		expect(callback.status).toBe(200);
		expect(await callback.text()).toContain('@student として');

		const forged = await app.request(`${ORIGIN}/callback?code=c1&state=forged`);
		expect(forged.status).toBe(400);
	});

	it('同意すると記録し、その人の開いている PR の検査を通す。ほかのサイトから送られたものは受け付けない', async () => {
		const { app, calls, records } = setup({ pulls: [{ number: 7, headSha: 'abc123' }] });
		const token = await signToken(
			'signing-key',
			{ repo: 'funmary-app/funmary', userId: 42, login: 'student' },
			NOW + 600,
		);
		const form = () => {
			const data = new FormData();
			data.set('token', token);
			return data;
		};

		const crossSite = await app.request(`${ORIGIN}/agree`, {
			method: 'POST',
			body: form(),
			headers: { Origin: 'https://evil.example.com' },
		});
		expect(crossSite.status).toBe(403);
		expect(records).toEqual([]);

		const response = await app.request(`${ORIGIN}/agree`, {
			method: 'POST',
			body: form(),
			headers: { Origin: ORIGIN },
		});
		expect(response.status).toBe(200);
		expect(records).toEqual([
			{
				githubUserId: 42,
				githubLogin: 'student',
				version: AGREEMENT_VERSION,
				agreedAt: new Date(NOW * 1000),
			},
		]);
		expect(calls.find((call) => call.method === 'setStatus')?.args.slice(0, 2)).toEqual([
			'funmary-app/funmary',
			'abc123',
		]);
	});
});
