import { describe, expect, it } from 'vitest';
import { createDiscordBot, DiscordApiError } from './discord-bot.ts';

interface Call {
	method: string;
	url: string;
	headers: Record<string, string>;
	body: unknown;
}

function setup(respond: (call: Call) => Response) {
	const calls: Call[] = [];
	const bot = createDiscordBot({
		token: 'secret-token',
		guildId: '111',
		fetch: (url, init) => {
			const call: Call = {
				method: init?.method ?? 'GET',
				url,
				headers: init?.headers as Record<string, string>,
				body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
			};
			calls.push(call);
			return Promise.resolve(respond(call));
		},
	});
	return { bot, calls };
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('createDiscordBot', () => {
	it('Bot のトークンを Authorization に付けて、ギルドのチャンネルを取る', async () => {
		const { bot, calls } = setup(() =>
			json([{ id: '1', name: 'deploy', type: 0, parent_id: '9', guild_id: '111' }]),
		);
		await expect(bot.listChannels()).resolves.toEqual([
			{ id: '1', name: 'deploy', type: 0, parentId: '9', guildId: '111' },
		]);
		expect(calls[0]?.url).toBe('https://discord.com/api/v10/guilds/111/channels');
		expect(calls[0]?.headers['Authorization']).toBe('Bot secret-token');
	});

	it('チャンネルを作るとき、権限の上書きを文字列の数値で送る', async () => {
		const { bot, calls } = setup(() => json({ id: '2', name: 'errors', type: 0 }));
		await bot.createChannel({
			name: 'errors',
			kind: 'text',
			parentId: '9',
			overwrites: [{ id: '111', kind: 'role', deny: 1024n }],
		});
		expect(calls[0]?.body).toEqual({
			name: 'errors',
			type: 0,
			parent_id: '9',
			permission_overwrites: [{ id: '111', type: 0, allow: '0', deny: '1024' }],
		});
	});

	it('メッセージを送るとき、メンションを指定したロールだけに効かせる', async () => {
		const { bot, calls } = setup(() => new Response(null, { status: 204 }));
		await bot.postMessage('5', '<@&7> 失敗しました', ['7']);
		expect(calls[0]?.body).toEqual({
			content: '<@&7> 失敗しました',
			allowed_mentions: { parse: [], roles: ['7'] },
		});
	});

	it('メンバーにロールを付け、外す (PUT と DELETE)', async () => {
		const { bot, calls } = setup(() => new Response(null, { status: 204 }));
		await bot.addMemberRole('222', '333');
		await bot.removeMemberRole('222', '333');
		expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
			'PUT https://discord.com/api/v10/guilds/111/members/222/roles/333',
			'DELETE https://discord.com/api/v10/guilds/111/members/222/roles/333',
		]);
	});

	it('存在しない、または見えないチャンネルは null にする', async () => {
		const { bot } = setup(() => json({ message: 'Unknown Channel' }, 404));
		await expect(bot.getChannel('5')).resolves.toBeNull();
	});

	it('失敗の例外に、ステータスと Discord の message だけを載せ、トークンは載せない', async () => {
		const { bot } = setup(() => json({ message: 'Missing Permissions' }, 403));
		const error = await bot.listRoles().catch((e: unknown) => e);
		expect(error).toBeInstanceOf(DiscordApiError);
		expect((error as DiscordApiError).status).toBe(403);
		expect((error as DiscordApiError).message).toBe(
			'Discord の API が 403 を返しました: Missing Permissions',
		);
		expect((error as DiscordApiError).message).not.toContain('secret-token');
	});
});
