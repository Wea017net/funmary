import type { API } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { describe, expect, it } from 'vitest';
import { createDiscordBot, DiscordApiError } from './discord-bot.ts';

/** 呼ばれた操作と引数を記録する、偽の API。返す値は、操作ごとに渡す */
function setup(results: Record<string, unknown> = {}, fail?: () => never) {
	const calls: [string, ...unknown[]][] = [];
	const op =
		(name: string) =>
		(...args: unknown[]) => {
			calls.push([name, ...args]);
			if (fail) fail();
			return Promise.resolve(results[name]);
		};
	const api = {
		users: { getCurrent: op('users.getCurrent'), createDM: op('users.createDM') },
		channels: {
			get: op('channels.get'),
			createMessage: op('channels.createMessage'),
			createThread: op('channels.createThread'),
			edit: op('channels.edit'),
			delete: op('channels.delete'),
			createInvite: op('channels.createInvite'),
		},
		invites: { delete: op('invites.delete') },
		threads: { addMember: op('threads.addMember') },
		guilds: {
			getChannels: op('guilds.getChannels'),
			getRoles: op('guilds.getRoles'),
			createChannel: op('guilds.createChannel'),
			createRole: op('guilds.createRole'),
			addRoleToMember: op('guilds.addRoleToMember'),
			removeRoleFromMember: op('guilds.removeRoleFromMember'),
			addMember: op('guilds.addMember'),
		},
	} as unknown as API;
	return { bot: createDiscordBot({ token: 'secret-token', guildId: '111', api }), calls };
}

const discordError = (status: number, message: string) =>
	new DiscordAPIError({ message, code: 0 }, 0, status, 'GET', 'https://discord.com/api/v10/x', {
		body: { content: 'secret-token' },
		files: undefined,
	});

describe('createDiscordBot', () => {
	it('招待を発行する。期限 0 は無期限、ロールを付け、同じ設定の招待を使い回さない', async () => {
		const { bot, calls } = setup({
			'channels.createInvite': { code: 'abc', expires_at: null },
		});
		await expect(
			bot.createInvite('5', { maxAgeSeconds: 0, maxUses: 0, roleIds: ['7'] }),
		).resolves.toEqual({ code: 'abc', expiresAt: null });
		expect(calls[0]).toEqual([
			'channels.createInvite',
			'5',
			{ max_age: 0, max_uses: 0, unique: true, role_ids: ['7'] },
		]);
	});

	it('期限のある招待は、期限の時刻を返す。ロールがなければ role_ids を送らない', async () => {
		const { bot, calls } = setup({
			'channels.createInvite': { code: 'xyz', expires_at: '2026-10-09T00:00:00.000Z' },
		});
		await expect(
			bot.createInvite('5', { maxAgeSeconds: 604800, maxUses: 10, roleIds: [] }),
		).resolves.toEqual({ code: 'xyz', expiresAt: new Date('2026-10-09T00:00:00.000Z') });
		expect(calls[0]?.[2]).toEqual({ max_age: 604800, max_uses: 10, unique: true });
	});

	it('招待を消す。もう無いもの (404) は、消せたことにする', async () => {
		const { bot, calls } = setup();
		await bot.deleteInvite('abc');
		expect(calls[0]).toEqual(['invites.delete', 'abc']);
		const gone = setup({}, () => {
			throw discordError(404, 'Unknown Invite');
		});
		await expect(gone.bot.deleteInvite('abc')).resolves.toBeUndefined();
	});

	it('ギルドのチャンネルを、使う項目だけの形にして返す', async () => {
		const { bot, calls } = setup({
			'guilds.getChannels': [
				{ id: '1', name: 'deploy', type: 0, parent_id: '9', guild_id: '111', extra: 1 },
			],
		});
		await expect(bot.listChannels()).resolves.toEqual([
			{ id: '1', name: 'deploy', type: 0, parentId: '9', guildId: '111' },
		]);
		expect(calls[0]).toEqual(['guilds.getChannels', '111']);
	});

	it('チャンネルを作るとき、権限の上書きを文字列の数値で送る', async () => {
		const { bot, calls } = setup({ 'guilds.createChannel': { id: '2', name: 'errors', type: 0 } });
		await bot.createChannel({
			name: 'errors',
			kind: 'text',
			parentId: '9',
			overwrites: [
				{ id: '111', kind: 'role', deny: 1024n },
				{ id: '999', kind: 'member', allow: 3072n },
			],
		});
		expect(calls[0]).toEqual([
			'guilds.createChannel',
			'111',
			{
				name: 'errors',
				type: 0,
				parent_id: '9',
				permission_overwrites: [
					{ id: '111', type: 0, allow: '0', deny: '1024' },
					{ id: '999', type: 1, allow: '3072', deny: '0' },
				],
			},
		]);
	});

	it('カテゴリは type 4 で作る', async () => {
		const { bot, calls } = setup({ 'guilds.createChannel': { id: '2', name: 'Funmary', type: 4 } });
		await bot.createChannel({ name: 'Funmary', kind: 'category' });
		expect(calls[0]?.[2]).toMatchObject({ name: 'Funmary', type: 4 });
	});

	it('メッセージを送るとき、メンションを指定したロールだけに効かせる', async () => {
		const { bot, calls } = setup();
		await bot.postMessage('5', '<@&7> 失敗しました', ['7']);
		expect(calls[0]).toEqual([
			'channels.createMessage',
			'5',
			{ content: '<@&7> 失敗しました', allowed_mentions: { parse: [], roles: ['7'] } },
		]);
	});

	it('メンバーにロールを付け、外す', async () => {
		const { bot, calls } = setup();
		await bot.addMemberRole('222', '333');
		await bot.removeMemberRole('222', '333');
		expect(calls).toEqual([
			['guilds.addRoleToMember', '111', '222', '333'],
			['guilds.removeRoleFromMember', '111', '222', '333'],
		]);
	});

	it('存在しない、または見えないチャンネルは null にする', async () => {
		const { bot } = setup({}, () => {
			throw discordError(404, 'Unknown Channel');
		});
		await expect(bot.getChannel('5')).resolves.toBeNull();
	});

	it('失敗の例外に、ステータスと Discord の message だけを載せ、トークンは載せない', async () => {
		const { bot } = setup({}, () => {
			throw discordError(403, 'Missing Permissions');
		});
		const error = await bot.listRoles().catch((e: unknown) => e);
		expect(error).toBeInstanceOf(DiscordApiError);
		expect((error as DiscordApiError).status).toBe(403);
		expect((error as DiscordApiError).message).toBe(
			'Discord の API が 403 を返しました: Missing Permissions',
		);
		expect((error as DiscordApiError).message).not.toContain('secret-token');
	});

	it('Discord の例外でないものは、そのまま投げる', async () => {
		const { bot } = setup({}, () => {
			throw new TypeError('network');
		});
		await expect(bot.me()).rejects.toThrow(TypeError);
	});

	it('DM チャンネルを開き、チャンネルの ID を返す', async () => {
		const { bot, calls } = setup({ 'users.createDM': { id: '8' } });
		await expect(bot.createDm('222')).resolves.toBe('8');
		expect(calls[0]).toEqual(['users.createDM', '222']);
	});

	it('本人だけの非公開スレッドを、invitable を false にして作る', async () => {
		const { bot, calls } = setup({ 'channels.createThread': { id: '9' } });
		await expect(bot.createPrivateThread('5', 'link-abc')).resolves.toBe('9');
		expect(calls[0]).toEqual([
			'channels.createThread',
			'5',
			{ name: 'link-abc', type: 12, invitable: false, auto_archive_duration: 10080 },
		]);
	});

	it('スレッドに利用者を加える', async () => {
		const { bot, calls } = setup();
		await bot.addThreadMember('9', '222');
		expect(calls[0]).toEqual(['threads.addMember', '9', '222']);
	});

	it('スレッドをアーカイブし、ロックする', async () => {
		const { bot, calls } = setup();
		await bot.archiveThread('9');
		expect(calls[0]).toEqual(['channels.edit', '9', { archived: true, locked: true }]);
	});

	it('スレッドのアーカイブが失敗しても、例外を投げない', async () => {
		const { bot } = setup({}, () => {
			throw discordError(404, 'Unknown Channel');
		});
		await expect(bot.archiveThread('9')).resolves.toBeUndefined();
	});

	it('アクセストークンを使って、利用者をギルドに参加させる', async () => {
		const { bot, calls } = setup();
		await bot.addGuildMember('222', 'user-access-token');
		expect(calls[0]).toEqual([
			'guilds.addMember',
			'111',
			'222',
			{ access_token: 'user-access-token' },
		]);
	});

	it('roleIds を渡すと、参加と同時にロールを付ける。空なら渡さない', async () => {
		const { bot, calls } = setup();
		await bot.addGuildMember('222', 'user-access-token', ['444', '555']);
		expect(calls[0]).toEqual([
			'guilds.addMember',
			'111',
			'222',
			{ access_token: 'user-access-token', roles: ['444', '555'] },
		]);
		await bot.addGuildMember('222', 'user-access-token', []);
		expect(calls[1]).toEqual([
			'guilds.addMember',
			'111',
			'222',
			{ access_token: 'user-access-token' },
		]);
	});

	it('スレッドを完全に削除する', async () => {
		const { bot, calls } = setup();
		await bot.deleteThread('9');
		expect(calls[0]).toEqual(['channels.delete', '9']);
	});
});
