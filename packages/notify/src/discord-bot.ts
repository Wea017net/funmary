// 管理用の Discord の Bot (設計書 14.8)。REST の API だけを使い、Gateway には常時接続しない。
// ギルドは 1 つだけ。チャンネルとロールを作り、メッセージを送る。トークンは呼ぶ側が環境変数から渡し、ログにも例外にも出さない。

const API = 'https://discord.com/api/v10';
const TIMEOUT_MS = 15_000;

/** 権限 (bit)。チャンネルを隠すのと、見せるのに使う */
const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;

/** チャンネルの種類 (Discord の定数) */
const GUILD_TEXT = 0;
const GUILD_CATEGORY = 4;

export class DiscordApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = 'DiscordApiError';
	}
}

export interface DiscordChannel {
	readonly id: string;
	readonly name: string;
	readonly type: number;
	readonly parentId: string | null;
	readonly guildId: string | null;
}

export interface DiscordRole {
	readonly id: string;
	readonly name: string;
}

export interface PermissionOverwrite {
	/** ロールか、メンバー (ユーザー) の ID */
	readonly id: string;
	readonly kind: 'role' | 'member';
	readonly allow?: bigint;
	readonly deny?: bigint;
}

export interface DiscordBot {
	readonly guildId: string;
	/** Bot 自身のユーザー ID */
	me(): Promise<string>;
	listChannels(): Promise<DiscordChannel[]>;
	listRoles(): Promise<DiscordRole[]>;
	getChannel(id: string): Promise<DiscordChannel | null>;
	createRole(name: string): Promise<DiscordRole>;
	createChannel(input: {
		name: string;
		kind: 'text' | 'category';
		parentId?: string;
		overwrites?: readonly PermissionOverwrite[];
	}): Promise<DiscordChannel>;
	/** メンションが効くのは、mentionRoles に挙げたロールだけにする */
	postMessage(channelId: string, content: string, mentionRoles?: readonly string[]): Promise<void>;
}

export interface DiscordBotOptions {
	readonly token: string;
	readonly guildId: string;
	readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

/** Discord の応答に含まれる形のうち、使うものだけ */
interface RawChannel {
	id: string;
	name?: string;
	type: number;
	parent_id?: string | null;
	guild_id?: string;
}

const toChannel = (raw: RawChannel): DiscordChannel => ({
	id: raw.id,
	name: raw.name ?? '',
	type: raw.type,
	parentId: raw.parent_id ?? null,
	guildId: raw.guild_id ?? null,
});

export function createDiscordBot(options: DiscordBotOptions): DiscordBot {
	const doFetch = options.fetch ?? fetch;
	const { guildId } = options;

	async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
		const response = await doFetch(`${API}${path}`, {
			method,
			headers: {
				Authorization: `Bot ${options.token}`,
				'Content-Type': 'application/json',
				'User-Agent': 'Funmary (https://github.com/oto-lab/funmary)',
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!response.ok) {
			// 本文に含まれる message だけを使う。リクエストの内容 (トークン) は載せない
			const detail = (await response.json().catch(() => null)) as { message?: unknown } | null;
			const message = typeof detail?.message === 'string' ? detail.message : response.statusText;
			throw new DiscordApiError(
				response.status,
				`Discord の API が ${response.status} を返しました: ${message}`,
			);
		}
		if (response.status === 204) return undefined as T;
		return (await response.json()) as T;
	}

	return {
		guildId,
		async me() {
			return (await call<{ id: string }>('GET', '/users/@me')).id;
		},
		async listChannels() {
			return (await call<RawChannel[]>('GET', `/guilds/${guildId}/channels`)).map(toChannel);
		},
		async listRoles() {
			return (await call<DiscordRole[]>('GET', `/guilds/${guildId}/roles`)).map(({ id, name }) => ({
				id,
				name,
			}));
		},
		async getChannel(id) {
			try {
				return toChannel(await call<RawChannel>('GET', `/channels/${id}`));
			} catch (error) {
				if (error instanceof DiscordApiError && (error.status === 404 || error.status === 403)) {
					return null;
				}
				throw error;
			}
		},
		async createRole(name) {
			const role = await call<DiscordRole>('POST', `/guilds/${guildId}/roles`, {
				name,
				mentionable: true,
			});
			return { id: role.id, name: role.name };
		},
		async createChannel({ name, kind, parentId, overwrites }) {
			return toChannel(
				await call<RawChannel>('POST', `/guilds/${guildId}/channels`, {
					name,
					type: kind === 'category' ? GUILD_CATEGORY : GUILD_TEXT,
					...(parentId ? { parent_id: parentId } : {}),
					...(overwrites
						? {
								permission_overwrites: overwrites.map((overwrite) => ({
									id: overwrite.id,
									type: overwrite.kind === 'role' ? 0 : 1,
									allow: String(overwrite.allow ?? 0n),
									deny: String(overwrite.deny ?? 0n),
								})),
							}
						: {}),
				}),
			);
		},
		async postMessage(channelId, content, mentionRoles = []) {
			await call('POST', `/channels/${channelId}/messages`, {
				content,
				allowed_mentions: { parse: [], roles: [...mentionRoles] },
			});
		},
	};
}

export const PERMISSIONS = { VIEW_CHANNEL, SEND_MESSAGES } as const;
export const CHANNEL_TYPES = { text: GUILD_TEXT, category: GUILD_CATEGORY } as const;
