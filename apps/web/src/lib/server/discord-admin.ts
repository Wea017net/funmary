// 管理画面の Discord の設定 (設計書 14.9)。チャンネルとロールを、Bot に任せるか、管理者が既存のものに置き換えるかを決める。
import {
	ADMIN_CHANNELS,
	ADMIN_ROLES,
	checkChannel,
	checkRole,
	type AdminChannel,
	type AdminRole,
	type DiscordBot,
	type DiscordLayout,
} from '@funmary/notify';

/** チャンネルとロールの配置を保存する設定の名前 */
export const DISCORD_LAYOUT_KEY = 'discord-layout';

export const CHANNEL_LABELS: Record<AdminChannel, string> = {
	deploy: 'ビルドとデプロイの結果',
	errors: '予期しないエラー、取得元の不調',
	sources: '定期処理と取り込みの結果',
	users: '新規登録、招待、退会、権限の変更',
	subjects: '科目の登録 (シラバスにない授業)',
	other: 'そのほか',
};

export const ROLE_LABELS: Record<AdminRole, string> = {
	deploy: 'デプロイの失敗を知らせる',
	errors: 'エラーを知らせる',
};

export interface DiscordRow {
	readonly name: string;
	readonly label: string;
	readonly id: string | null;
	/** Bot が作ったか、同じ名前で見つけたもの。false は管理者が置き換えたもの */
	readonly managed: boolean;
}

export interface DiscordAdminView {
	readonly botConfigured: boolean;
	readonly guildId: string | null;
	readonly channels: readonly DiscordRow[];
	readonly roles: readonly DiscordRow[];
}

export function toDiscordView(bot: DiscordBot | null, layout: DiscordLayout): DiscordAdminView {
	return {
		botConfigured: bot !== null,
		guildId: bot?.guildId ?? null,
		channels: ADMIN_CHANNELS.map((name) => ({
			name,
			label: CHANNEL_LABELS[name],
			id: layout.channels[name]?.id ?? null,
			managed: layout.channels[name]?.managed ?? true,
		})),
		roles: ADMIN_ROLES.map((name) => ({
			name,
			label: ROLE_LABELS[name],
			id: layout.roles[name]?.id ?? null,
			managed: layout.roles[name]?.managed ?? true,
		})),
	};
}

export type ReplaceResult =
	| { readonly ok: true; readonly layout: DiscordLayout }
	| { readonly ok: false; readonly error: string };

const isChannelName = (value: string): value is AdminChannel =>
	(ADMIN_CHANNELS as readonly string[]).includes(value);
const isRoleName = (value: string): value is AdminRole =>
	(ADMIN_ROLES as readonly string[]).includes(value);

/** チャンネルかロールを、管理者が指定した ID に置き換える。使えるかを Discord で確かめてから */
export async function replaceEntry(
	bot: DiscordBot,
	layout: DiscordLayout,
	kind: 'channel' | 'role',
	name: string,
	id: string,
): Promise<ReplaceResult> {
	const trimmed = id.trim();
	if (!/^\d{5,25}$/.test(trimmed)) return { ok: false, error: 'ID は数字だけで入れてください。' };
	if (kind === 'channel') {
		if (!isChannelName(name)) return { ok: false, error: '知らないチャンネルです。' };
		const check = await checkChannel(bot, trimmed);
		if (!check.ok) return { ok: false, error: check.reason };
		return {
			ok: true,
			layout: {
				...layout,
				channels: { ...layout.channels, [name]: { id: trimmed, managed: false } },
			},
		};
	}
	if (!isRoleName(name)) return { ok: false, error: '知らないロールです。' };
	const check = await checkRole(bot, trimmed);
	if (!check.ok) return { ok: false, error: check.reason };
	return {
		ok: true,
		layout: { ...layout, roles: { ...layout.roles, [name]: { id: trimmed, managed: false } } },
	};
}

/** 置き換えを取り消して、Bot に任せる。次に整えるときに、同じ名前のものを探して使うか、作る */
export function useBot(
	layout: DiscordLayout,
	kind: 'channel' | 'role',
	name: string,
): DiscordLayout {
	if (kind === 'channel') {
		return {
			...layout,
			channels: Object.fromEntries(Object.entries(layout.channels).filter(([key]) => key !== name)),
		};
	}
	return {
		...layout,
		roles: Object.fromEntries(Object.entries(layout.roles).filter(([key]) => key !== name)),
	};
}
