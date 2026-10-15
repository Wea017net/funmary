import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiscordOAuthClient, DiscordOAuthError } from './discord-oauth.ts';

const options = {
	clientId: 'client-1',
	clientSecret: 'secret-1',
	redirectUri: 'https://funmary.example.com/app/settings/discord',
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('createDiscordOAuthClient', () => {
	it('認可の URL に、client_id、redirect_uri、scope、state を載せる', () => {
		const client = createDiscordOAuthClient(options);
		const url = new URL(client.authorizationUrl('state-1'));
		expect(url.origin + url.pathname).toBe('https://discord.com/api/oauth2/authorize');
		expect(url.searchParams.get('client_id')).toBe('client-1');
		expect(url.searchParams.get('redirect_uri')).toBe(options.redirectUri);
		expect(url.searchParams.get('scope')).toBe('identify guilds.join');
		expect(url.searchParams.get('state')).toBe('state-1');
		expect(url.searchParams.get('response_type')).toBe('code');
	});

	it('認可コードをトークンに交換する', async () => {
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 604800 }),
				{ status: 200 },
			),
		);
		const client = createDiscordOAuthClient(options);
		const tokens = await client.exchangeCode('code-1');
		expect(tokens.accessToken).toBe('at');
		expect(tokens.refreshToken).toBe('rt');
		expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now());

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://discord.com/api/oauth2/token');
		const body = (init.body as URLSearchParams).toString();
		expect(body).toContain('grant_type=authorization_code');
		expect(body).toContain('code=code-1');
		expect(body).toContain('client_secret=secret-1');
	});

	it('トークンの交換に失敗したら、本文を含む例外を投げる', async () => {
		fetchMock.mockResolvedValue(new Response('invalid_grant', { status: 400 }));
		const client = createDiscordOAuthClient(options);
		await expect(client.exchangeCode('bad')).rejects.toThrow(DiscordOAuthError);
	});

	it('アクセストークンで、本人の Discord のユーザーを取る', async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ id: '222', username: 'someone' }), { status: 200 }),
		);
		const client = createDiscordOAuthClient(options);
		await expect(client.fetchCurrentUser('at')).resolves.toEqual({
			id: '222',
			username: 'someone',
		});
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://discord.com/api/users/@me');
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer at');
	});

	it('取り消しが失敗しても、例外を投げない', async () => {
		fetchMock.mockRejectedValue(new Error('network'));
		const client = createDiscordOAuthClient(options);
		await expect(client.revoke('at')).resolves.toBeUndefined();
	});
});
