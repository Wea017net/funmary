// 利用者の Discord アカウントの連携 (設計書 14.9)。OAuth の認可コードの交換と、取り消しだけを行う。
// Bot のトークンとは別の、アプリの Client ID と Client Secret を使う (Discord Developer Portal の OAuth2 タブ)。

const AUTHORIZE_URL = 'https://discord.com/api/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const REVOKE_URL = 'https://discord.com/api/oauth2/token/revoke';
const ME_URL = 'https://discord.com/api/users/@me';

/** 連携で頼むスコープ。identify で ID を知り、guilds.join でサポートサーバーに入れる */
export const DISCORD_OAUTH_SCOPE = 'identify guilds.join';

export interface DiscordOAuthOptions {
	readonly clientId: string;
	readonly clientSecret: string;
	readonly redirectUri: string;
}

export interface DiscordOAuthTokens {
	readonly accessToken: string;
	readonly refreshToken: string;
	readonly expiresAt: Date;
}

export interface DiscordOAuthUser {
	readonly id: string;
	readonly username: string;
}

/** Discord から返るエラー。トークンなどの秘密の値は含めない */
export class DiscordOAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DiscordOAuthError';
	}
}

export interface DiscordOAuthClient {
	/** 認可の URL。state は呼び出し側が作り、Cookie などで CSRF を確かめる */
	authorizationUrl(state: string): string;
	/** 認可コードをトークンに交換する */
	exchangeCode(code: string): Promise<DiscordOAuthTokens>;
	/** アクセストークンで、連携した本人の Discord のユーザーを取る */
	fetchCurrentUser(accessToken: string): Promise<DiscordOAuthUser>;
	/** トークンを取り消す。失敗しても投げない (呼び出し側で無視してよい、設計書 14.9) */
	revoke(token: string): Promise<void>;
}

async function readJson(response: Response, action: string): Promise<unknown> {
	if (!response.ok) {
		// エラーの本文はトークンを含まないので、そのままメッセージにしてよい
		const body = await response.text().catch(() => '');
		throw new DiscordOAuthError(`Discord の ${action} が ${response.status} を返しました: ${body}`);
	}
	return response.json();
}

export function createDiscordOAuthClient(options: DiscordOAuthOptions): DiscordOAuthClient {
	const basicAuth = () => {
		const params = new URLSearchParams({
			client_id: options.clientId,
			client_secret: options.clientSecret,
		});
		return params;
	};

	return {
		authorizationUrl(state) {
			const url = new URL(AUTHORIZE_URL);
			url.searchParams.set('client_id', options.clientId);
			url.searchParams.set('redirect_uri', options.redirectUri);
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', DISCORD_OAUTH_SCOPE);
			url.searchParams.set('state', state);
			return url.toString();
		},

		async exchangeCode(code) {
			const body = basicAuth();
			body.set('grant_type', 'authorization_code');
			body.set('code', code);
			body.set('redirect_uri', options.redirectUri);
			const response = await fetch(TOKEN_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body,
			});
			const json = (await readJson(response, 'トークンの取得')) as {
				access_token: string;
				refresh_token: string;
				expires_in: number;
			};
			return {
				accessToken: json.access_token,
				refreshToken: json.refresh_token,
				expiresAt: new Date(Date.now() + json.expires_in * 1000),
			};
		},

		async fetchCurrentUser(accessToken) {
			const response = await fetch(ME_URL, {
				headers: { Authorization: `Bearer ${accessToken}` },
			});
			const json = (await readJson(response, 'ユーザー情報の取得')) as {
				id: string;
				username: string;
			};
			return { id: json.id, username: json.username };
		},

		async revoke(token) {
			try {
				const body = basicAuth();
				body.set('token', token);
				await fetch(REVOKE_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
					body,
				});
			} catch {
				// 取り消せなくても、Funmary 側の連携解除は止めない (設計書 14.9)
			}
		},
	};
}
