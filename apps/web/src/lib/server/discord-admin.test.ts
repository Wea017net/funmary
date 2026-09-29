import {
	DiscordApiError,
	EMPTY_LAYOUT,
	type DiscordBot,
	type DiscordLayout,
} from '@funmary/notify';
import { describe, expect, it } from 'vitest';
import { changeMemberRole, replaceEntry, toDiscordView, useBot } from './discord-admin.ts';

const bot = {
	guildId: '111',
	getChannel: (id: string) =>
		Promise.resolve(
			id === '55555' ? { id, name: 'x', type: 0, parentId: null, guildId: '111' } : null,
		),
	listRoles: () => Promise.resolve([{ id: '777', name: 'r' }]),
} as unknown as DiscordBot;

describe('replaceEntry', () => {
	it('使えるチャンネルなら、手動として置き換える', async () => {
		const result = await replaceEntry(bot, EMPTY_LAYOUT, 'channel', 'errors', ' 55555 ');
		expect(result).toEqual({
			ok: true,
			layout: { ...EMPTY_LAYOUT, channels: { errors: { id: '55555', managed: false } } },
		});
	});

	it('見つからないチャンネル、数字でない ID、知らない名前は、置き換えない', async () => {
		await expect(
			replaceEntry(bot, EMPTY_LAYOUT, 'channel', 'errors', '999999'),
		).resolves.toMatchObject({ ok: false });
		await expect(replaceEntry(bot, EMPTY_LAYOUT, 'channel', 'errors', 'abc')).resolves.toEqual({
			ok: false,
			error: 'ID は数字だけで入れてください。',
		});
		await expect(
			replaceEntry(bot, EMPTY_LAYOUT, 'channel', 'nope', '55555'),
		).resolves.toMatchObject({ ok: false });
	});

	it('ギルドにあるロールなら置き換え、なければ置き換えない', async () => {
		await expect(replaceEntry(bot, EMPTY_LAYOUT, 'role', 'deploy', '777')).resolves.toMatchObject({
			ok: false,
		});
		const roleBot = {
			...bot,
			listRoles: () => Promise.resolve([{ id: '77777', name: 'r' }]),
		};
		await expect(
			replaceEntry(roleBot, EMPTY_LAYOUT, 'role', 'deploy', '77777'),
		).resolves.toMatchObject({ ok: true });
		await expect(
			replaceEntry(roleBot, EMPTY_LAYOUT, 'role', 'deploy', '88888'),
		).resolves.toMatchObject({ ok: false });
	});
});

describe('useBot と toDiscordView', () => {
	const layout: DiscordLayout = {
		category: { id: '1', managed: true },
		channels: { errors: { id: '55555', managed: false }, deploy: { id: '556', managed: true } },
		roles: {},
	};

	it('置き換えを取り消すと、その項目だけが未設定に戻る', () => {
		expect(useBot(layout, 'channel', 'errors').channels).toEqual({
			deploy: { id: '556', managed: true },
		});
	});

	it('画面用に、6 本のチャンネルと 3 つのロールを、ID と手動かどうかとあわせて並べる', () => {
		const view = toDiscordView(bot, layout);
		expect(view.botConfigured).toBe(true);
		expect(view.channels.map((c) => c.name)).toEqual([
			'deploy',
			'errors',
			'sources',
			'users',
			'subjects',
			'other',
		]);
		expect(view.channels[1]).toMatchObject({ id: '55555', managed: false });
		expect(view.channels[2]).toMatchObject({ id: null, managed: true });
		expect(view.roles).toHaveLength(3);
		expect(toDiscordView(null, layout).botConfigured).toBe(false);
	});
});

describe('changeMemberRole', () => {
	const layout: DiscordLayout = {
		...EMPTY_LAYOUT,
		roles: { deploy: { id: '31313', managed: true } },
	};
	function memberBot(failWith?: number) {
		const calls: string[] = [];
		const fake = {
			addMemberRole: (user: string, role: string) => {
				calls.push(`add ${user} ${role}`);
				return failWith ? Promise.reject(new DiscordApiError(failWith, 'x')) : Promise.resolve();
			},
			removeMemberRole: (user: string, role: string) => {
				calls.push(`remove ${user} ${role}`);
				return Promise.resolve();
			},
		} as unknown as DiscordBot;
		return { fake, calls };
	}

	it('ロールを付け、外す', async () => {
		const { fake, calls } = memberBot();
		await expect(changeMemberRole(fake, layout, 'add', 'deploy', ' 22222 ')).resolves.toEqual({
			ok: true,
			message: 'ユーザー 22222 に、ロール funmary-deploy を付けました。',
		});
		await expect(
			changeMemberRole(fake, layout, 'remove', 'deploy', '22222'),
		).resolves.toMatchObject({
			ok: true,
		});
		expect(calls).toEqual(['add 22222 31313', 'remove 22222 31313']);
	});

	it('数字でない ID、知らないロール、まだ決まっていないロールは、Discord に送らない', async () => {
		const { fake, calls } = memberBot();
		await expect(changeMemberRole(fake, layout, 'add', 'deploy', 'abc')).resolves.toMatchObject({
			ok: false,
		});
		await expect(changeMemberRole(fake, layout, 'add', 'nope', '22222')).resolves.toMatchObject({
			ok: false,
		});
		await expect(changeMemberRole(fake, layout, 'add', 'errors', '22222')).resolves.toMatchObject({
			ok: false,
		});
		expect(calls).toEqual([]);
	});

	it('サーバーにいないユーザー (404) と、権限がないとき (403) は、直し方を返す', async () => {
		const notMember = await changeMemberRole(memberBot(404).fake, layout, 'add', 'deploy', '22222');
		expect(notMember.ok).toBe(false);
		expect(notMember.ok ? '' : notMember.error).toContain('サーバーにいません');
		const forbidden = await changeMemberRole(memberBot(403).fake, layout, 'add', 'deploy', '22222');
		expect(forbidden.ok).toBe(false);
		expect(forbidden.ok ? '' : forbidden.error).toContain('Bot のロール');
	});
});
