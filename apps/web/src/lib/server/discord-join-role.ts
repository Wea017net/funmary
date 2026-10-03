// 利用者が OAuth2 の連携でサーバーに参加したときに付けるロール (設計書 14.9、#163)。
// 管理者が、独自に選んだロール、登録済みの招待リンクと同じロール、または付けない (既定) のどれかを決める。DB の settings に置く
import type { SupportInvite } from './support-invites.ts';

export const DISCORD_JOIN_ROLE_KEY = 'discord-join-role';

export type DiscordJoinRoleSetting =
	| { readonly mode: 'none' }
	| { readonly mode: 'custom'; readonly roleIds: readonly string[] }
	/** 登録済みの招待リンク (SupportInvite) の 1 つを選び、その roles をそのまま使う */
	| { readonly mode: 'invite'; readonly inviteId: string };

const NONE: DiscordJoinRoleSetting = { mode: 'none' };

const isStringArray = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((item) => typeof item === 'string');

/** 保存された値を読む。形が違うときは「付けない」にする */
export function readDiscordJoinRole(value: unknown): DiscordJoinRoleSetting {
	if (typeof value !== 'object' || value === null) return NONE;
	const v = value as Record<string, unknown>;
	if (v['mode'] === 'custom' && isStringArray(v['roleIds']) && v['roleIds'].length > 0) {
		return { mode: 'custom', roleIds: v['roleIds'] };
	}
	if (v['mode'] === 'invite' && typeof v['inviteId'] === 'string') {
		return { mode: 'invite', inviteId: v['inviteId'] };
	}
	return NONE;
}

/** 管理画面のフォームの値。入力が足りなければ error */
export function parseDiscordJoinRoleForm(
	form: FormData,
): { ok: true; value: DiscordJoinRoleSetting } | { ok: false; error: string } {
	const mode = form.get('mode');
	if (mode === 'none') return { ok: true, value: NONE };
	if (mode === 'custom') {
		const roleIds = form.getAll('roleIds').filter((v): v is string => typeof v === 'string');
		if (roleIds.length === 0) return { ok: false, error: 'ロールを 1 つ以上選んでください。' };
		return { ok: true, value: { mode: 'custom', roleIds } };
	}
	if (mode === 'invite') {
		const inviteId = form.get('inviteId');
		if (typeof inviteId !== 'string' || inviteId === '') {
			return { ok: false, error: '招待リンクを選んでください。' };
		}
		return { ok: true, value: { mode: 'invite', inviteId } };
	}
	return { ok: false, error: '入力が足りません。' };
}

/** 実際に付けるロールの ID の一覧にする。招待と同様なら、その招待に設定された roles をそのまま使う */
export function resolveJoinRoleIds(
	setting: DiscordJoinRoleSetting,
	invites: readonly SupportInvite[],
): readonly string[] {
	if (setting.mode === 'custom') return setting.roleIds;
	if (setting.mode === 'invite') {
		return invites.find((invite) => invite.id === setting.inviteId)?.roles.map((r) => r.id) ?? [];
	}
	return [];
}
