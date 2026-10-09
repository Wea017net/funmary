// 管理用の Discord の Bot。ギルドは 1 つだけ。チャンネルとロールを作り、メッセージを送り、ロールを付ける。
// Discord の API の呼び出し、レート制限、再試行は、公式の @discordjs/core と @discordjs/rest に任せる。
// このファイルは、Funmary が使う操作だけに絞った入れ物 (DiscordBot) にして、例外を、トークンを含まない形にそろえる。
import { API, ChannelType, OverwriteType } from '@discordjs/core';
import { DiscordAPIError, REST } from '@discordjs/rest';

const TIMEOUT_MS = 15_000;

/** 権限 (bit)。チャンネルを隠すのと、見せるのに使う */
const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;

/** 画面と設定に出す例外。ステータスと Discord の message だけを持ち、トークンは含まない */
export class DiscordApiError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'DiscordApiError';
		this.status = status;
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

/** 埋め込みのメッセージ。使う項目だけ */
export interface DiscordEmbed {
	readonly title?: string;
	readonly description?: string;
	readonly url?: string;
	readonly color?: number;
	/** ISO 8601 */
	readonly timestamp?: string;
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
	/** メンバーにロールを付ける。メンバーがギルドにいなければ、404 の DiscordApiError */
	addMemberRole(userId: string, roleId: string): Promise<void>;
	/** メンバーからロールを外す */
	removeMemberRole(userId: string, roleId: string): Promise<void>;
	/** メンションが効くのは、mentionRoles に挙げたロールだけにする */
	postMessage(channelId: string, content: string, mentionRoles?: readonly string[]): Promise<void>;
	/** 埋め込みのメッセージを送る。mentionUserId を渡すと、その利用者だけにメンションする (既定は効かせない) */
	postEmbed(channelId: string, embed: DiscordEmbed, mentionUserId?: string): Promise<void>;
	/** 利用者との DM チャンネルを開く。相手が DM を拒否していれば 403 の DiscordApiError */
	createDm(userId: string): Promise<string>;
	/** 親のチャンネルの下に、本人だけの非公開スレッドを作る (invitable は false 固定) */
	createPrivateThread(parentChannelId: string, name: string): Promise<string>;
	/** スレッドに利用者を加える。相手がギルドにいなければ 404 の DiscordApiError */
	addThreadMember(threadId: string, userId: string): Promise<void>;
	/** スレッドをアーカイブする (消しはしない)。失敗しても投げない (呼び出し側で無視してよい) */
	archiveThread(threadId: string): Promise<void>;
	/** スレッドを完全に削除する (履歴も含めて消え、アーカイブと違って元に戻せない) */
	deleteThread(threadId: string): Promise<void>;
	/**
	 * OAuth のアクセストークンを使って、利用者をギルドに参加させる。既に参加済みなら何もしない。
	 * roleIds を渡すと、参加と同時にそのロールを付ける (Bot に「ロールの管理」が要り、Bot より上のロールは付けられない)
	 */
	addGuildMember(userId: string, accessToken: string, roleIds?: readonly string[]): Promise<void>;
	/**
	 * チャンネルへの招待を発行する。maxAgeSeconds が 0 なら無期限、maxUses が 0 なら回数の制限なし。
	 * roleIds のロールは、招待を受けて参加した人に Discord が付ける (Bot に「ロールの管理」が要り、Bot より上のロールは付けられない)
	 */
	createInvite(
		channelId: string,
		options: { maxAgeSeconds: number; maxUses: number; roleIds: readonly string[] },
	): Promise<{ code: string; expiresAt: Date | null }>;
	/** 招待を消す。もう無ければ何もしない */
	deleteInvite(code: string): Promise<void>;
}

export interface DiscordBotOptions {
	readonly token: string;
	readonly guildId: string;
	/** 差し替え用 (テスト)。省くと、token から作る */
	readonly api?: API;
}

/** Discord の応答に含まれる形のうち、使うものだけ */
interface RawChannel {
	id: string;
	name?: string | null;
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

/** ライブラリの例外を、トークンを含まない DiscordApiError にそろえる */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		if (error instanceof DiscordAPIError) {
			const status = typeof error.status === 'number' ? error.status : 0;
			throw new DiscordApiError(
				status,
				`Discord の API が ${status} を返しました: ${error.message}`,
			);
		}
		throw error;
	}
}

export function createDiscordBot(options: DiscordBotOptions): DiscordBot {
	const api =
		options.api ??
		new API(new REST({ version: '10', timeout: TIMEOUT_MS, retries: 2 }).setToken(options.token));
	const { guildId } = options;

	return {
		guildId,
		me: () => guarded(async () => (await api.users.getCurrent()).id),
		listChannels: () =>
			guarded(async () => (await api.guilds.getChannels(guildId)).map((c) => toChannel(c))),
		listRoles: () =>
			guarded(async () =>
				(await api.guilds.getRoles(guildId)).map(({ id, name }) => ({ id, name })),
			),
		async getChannel(id) {
			try {
				return await guarded(async () => toChannel(await api.channels.get(id)));
			} catch (error) {
				if (error instanceof DiscordApiError && (error.status === 404 || error.status === 403)) {
					return null;
				}
				throw error;
			}
		},
		createRole: (name) =>
			guarded(async () => {
				const role = await api.guilds.createRole(guildId, { name, mentionable: true });
				return { id: role.id, name: role.name };
			}),
		createChannel: ({ name, kind, parentId, overwrites }) =>
			guarded(async () =>
				toChannel(
					await api.guilds.createChannel(guildId, {
						name,
						type: kind === 'category' ? ChannelType.GuildCategory : ChannelType.GuildText,
						...(parentId ? { parent_id: parentId } : {}),
						...(overwrites
							? {
									permission_overwrites: overwrites.map((overwrite) => ({
										id: overwrite.id,
										type: overwrite.kind === 'role' ? OverwriteType.Role : OverwriteType.Member,
										allow: String(overwrite.allow ?? 0n),
										deny: String(overwrite.deny ?? 0n),
									})),
								}
							: {}),
					}),
				),
			),
		addMemberRole: (userId, roleId) =>
			guarded(() => api.guilds.addRoleToMember(guildId, userId, roleId)),
		removeMemberRole: (userId, roleId) =>
			guarded(() => api.guilds.removeRoleFromMember(guildId, userId, roleId)),
		postMessage: (channelId, content, mentionRoles = []) =>
			guarded(async () => {
				await api.channels.createMessage(channelId, {
					content,
					allowed_mentions: { parse: [], roles: [...mentionRoles] },
				});
			}),
		postEmbed: (channelId, embed, mentionUserId) =>
			guarded(async () => {
				await api.channels.createMessage(channelId, {
					...(mentionUserId ? { content: `<@${mentionUserId}>` } : {}),
					embeds: [embed],
					allowed_mentions: mentionUserId ? { users: [mentionUserId] } : { parse: [] },
				});
			}),
		createDm: (userId) => guarded(async () => (await api.users.createDM(userId)).id),
		createPrivateThread: (parentChannelId, name) =>
			guarded(async () => {
				const thread = await api.channels.createThread(parentChannelId, {
					name,
					type: ChannelType.GuildPrivateThread,
					invitable: false,
					// 7 日 (最大値)。滅多に使わないので、短いと自動でアーカイブされてしまう
					auto_archive_duration: 10080,
				});
				return thread.id;
			}),
		addThreadMember: (threadId, userId) => guarded(() => api.threads.addMember(threadId, userId)),
		async archiveThread(threadId) {
			try {
				await guarded(() => api.channels.edit(threadId, { archived: true, locked: true }));
			} catch {
				// 消えている、権限がないなどでも、呼び出し側の処理は止めない
			}
		},
		deleteThread: (threadId) => guarded(async () => void (await api.channels.delete(threadId))),
		// 既に参加済みなら 204 (No Content) が返るだけで、例外にはならない
		addGuildMember: (userId, accessToken, roleIds) =>
			guarded(async () => {
				await api.guilds.addMember(guildId, userId, {
					access_token: accessToken,
					...(roleIds && roleIds.length > 0 ? { roles: [...roleIds] } : {}),
				});
			}),
		createInvite: (channelId, { maxAgeSeconds, maxUses, roleIds }) =>
			guarded(async () => {
				const invite = await api.channels.createInvite(channelId, {
					max_age: maxAgeSeconds,
					max_uses: maxUses,
					// 同じ設定の招待があっても、使い回さずに新しく作る (取り消しを別々にできるように)
					unique: true,
					...(roleIds.length > 0 ? { role_ids: [...roleIds] } : {}),
				});
				return {
					code: invite.code,
					expiresAt: invite.expires_at ? new Date(invite.expires_at) : null,
				};
			}),
		async deleteInvite(code) {
			try {
				await guarded(() => api.invites.delete(code));
			} catch (error) {
				if (error instanceof DiscordApiError && error.status === 404) return;
				throw error;
			}
		},
	};
}

export const PERMISSIONS = { VIEW_CHANNEL, SEND_MESSAGES } as const;
/** チャンネルの種類。Discord の応答の type (数値) と比べやすいよう、数値にしておく */
export const CHANNEL_TYPES = {
	text: Number(ChannelType.GuildText),
	category: Number(ChannelType.GuildCategory),
};
