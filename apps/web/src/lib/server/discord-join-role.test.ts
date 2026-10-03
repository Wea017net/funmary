import { describe, expect, it } from 'vitest';
import {
	parseDiscordJoinRoleForm,
	readDiscordJoinRole,
	resolveJoinRoleIds,
	type DiscordJoinRoleSetting,
} from './discord-join-role.ts';
import type { SupportInvite } from './support-invites.ts';

const invite = (overrides: Partial<SupportInvite> = {}): SupportInvite => ({
	id: 'inv-1',
	code: 'abc',
	source: 'bot',
	public: false,
	channelId: '1',
	roles: [{ id: 'role-1', name: 'funmary-member' }],
	note: null,
	maxUses: 0,
	createdAt: '2026-10-01T00:00:00Z',
	expiresAt: null,
	revokedAt: null,
	...overrides,
});

describe('readDiscordJoinRole', () => {
	it('形が違う、保存されていない値は「付けない」にする', () => {
		expect(readDiscordJoinRole(undefined)).toEqual({ mode: 'none' });
		expect(readDiscordJoinRole({})).toEqual({ mode: 'none' });
		expect(readDiscordJoinRole({ mode: 'custom', roleIds: [] })).toEqual({ mode: 'none' });
		expect(readDiscordJoinRole({ mode: 'invite' })).toEqual({ mode: 'none' });
	});

	it('独自に選んだロールを読む', () => {
		expect(readDiscordJoinRole({ mode: 'custom', roleIds: ['1', '2'] })).toEqual({
			mode: 'custom',
			roleIds: ['1', '2'],
		});
	});

	it('招待と同様の設定を読む', () => {
		expect(readDiscordJoinRole({ mode: 'invite', inviteId: 'inv-1' })).toEqual({
			mode: 'invite',
			inviteId: 'inv-1',
		});
	});
});

describe('parseDiscordJoinRoleForm', () => {
	it('none はそのまま通る', () => {
		const form = new FormData();
		form.set('mode', 'none');
		expect(parseDiscordJoinRoleForm(form)).toEqual({ ok: true, value: { mode: 'none' } });
	});

	it('custom はロールを 1 つ以上要る', () => {
		const empty = new FormData();
		empty.set('mode', 'custom');
		expect(parseDiscordJoinRoleForm(empty).ok).toBe(false);

		const form = new FormData();
		form.set('mode', 'custom');
		form.append('roleIds', '1');
		form.append('roleIds', '2');
		expect(parseDiscordJoinRoleForm(form)).toEqual({
			ok: true,
			value: { mode: 'custom', roleIds: ['1', '2'] },
		});
	});

	it('invite は inviteId が要る', () => {
		const empty = new FormData();
		empty.set('mode', 'invite');
		expect(parseDiscordJoinRoleForm(empty).ok).toBe(false);

		const form = new FormData();
		form.set('mode', 'invite');
		form.set('inviteId', 'inv-1');
		expect(parseDiscordJoinRoleForm(form)).toEqual({
			ok: true,
			value: { mode: 'invite', inviteId: 'inv-1' },
		});
	});

	it('知らない mode は失敗にする', () => {
		const form = new FormData();
		form.set('mode', 'something');
		expect(parseDiscordJoinRoleForm(form).ok).toBe(false);
	});
});

describe('resolveJoinRoleIds', () => {
	it('custom はそのまま、none は空配列', () => {
		expect(resolveJoinRoleIds({ mode: 'custom', roleIds: ['1', '2'] }, [])).toEqual(['1', '2']);
		expect(resolveJoinRoleIds({ mode: 'none' }, [])).toEqual([]);
	});

	it('invite は、その招待の roles を使う。見つからなければ空配列', () => {
		const invites = [invite()];
		const setting: DiscordJoinRoleSetting = { mode: 'invite', inviteId: 'inv-1' };
		expect(resolveJoinRoleIds(setting, invites)).toEqual(['role-1']);
		expect(resolveJoinRoleIds({ mode: 'invite', inviteId: 'unknown' }, invites)).toEqual([]);
	});
});
