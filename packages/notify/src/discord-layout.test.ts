import { describe, expect, it } from 'vitest';
import type { DiscordBot, DiscordChannel, DiscordRole } from './discord-bot.ts';
import {
	ADMIN_CHANNELS,
	checkChannel,
	EMPTY_LAYOUT,
	ensureLayout,
	parseLayout,
} from './discord-layout.ts';

/** メモリの中のギルド。作ったものを、そのあとの一覧に出す */
function fakeBot(initial: { channels?: DiscordChannel[]; roles?: DiscordRole[] } = {}) {
	const channels = [...(initial.channels ?? [])];
	const roles = [...(initial.roles ?? [])];
	const created: string[] = [];
	let next = 1000;
	const bot: DiscordBot = {
		guildId: '111',
		me: () => Promise.resolve('999'),
		listChannels: () => Promise.resolve([...channels]),
		listRoles: () => Promise.resolve([...roles]),
		getChannel: (id) => Promise.resolve(channels.find((c) => c.id === id) ?? null),
		createRole: (name) => {
			const role = { id: String(next++), name };
			roles.push(role);
			created.push(`role:${name}`);
			return Promise.resolve(role);
		},
		createChannel: ({ name, kind, parentId }) => {
			const channel: DiscordChannel = {
				id: String(next++),
				name,
				type: kind === 'category' ? 4 : 0,
				parentId: parentId ?? null,
				guildId: '111',
			};
			channels.push(channel);
			created.push(`${kind}:${name}`);
			return Promise.resolve(channel);
		},
		addMemberRole: () => Promise.resolve(),
		removeMemberRole: () => Promise.resolve(),
		postMessage: () => Promise.resolve(),
		createDm: () => Promise.resolve('dm-channel'),
		createPrivateThread: () => Promise.resolve('thread'),
		addThreadMember: () => Promise.resolve(),
		archiveThread: () => Promise.resolve(),
		addGuildMember: () => Promise.resolve(),
		createInvite: () => Promise.resolve({ code: 'abc', expiresAt: null }),
		deleteInvite: () => Promise.resolve(),
	};
	return { bot, created };
}

describe('ensureLayout', () => {
	it('何もなければ、ロール 3 つ、カテゴリ 1 つ、チャンネル 7 本を作る', async () => {
		const { bot, created } = fakeBot();
		const { layout } = await ensureLayout(bot, EMPTY_LAYOUT);
		expect(created).toEqual([
			'role:funmary-deploy',
			'role:funmary-errors',
			'role:funmary-subjects',
			'category:Funmary',
			...ADMIN_CHANNELS.map((name) => `text:${name}`),
		]);
		expect(Object.keys(layout.channels)).toEqual([...ADMIN_CHANNELS]);
		expect(layout.category?.managed).toBe(true);
	});

	it('もう一度実行しても、何も作らない', async () => {
		const { bot, created } = fakeBot();
		const first = await ensureLayout(bot, EMPTY_LAYOUT);
		created.length = 0;
		const second = await ensureLayout(bot, first.layout);
		expect(created).toEqual([]);
		expect(second.layout).toEqual(first.layout);
		expect(second.actions).toEqual([]);
	});

	it('DB の記録が消えても、同じ名前のものを使い、重複して作らない', async () => {
		const { bot, created } = fakeBot();
		await ensureLayout(bot, EMPTY_LAYOUT);
		created.length = 0;
		const { layout, actions } = await ensureLayout(bot, EMPTY_LAYOUT);
		expect(created).toEqual([]);
		expect(Object.keys(layout.channels)).toHaveLength(ADMIN_CHANNELS.length);
		expect(actions.length).toBeGreaterThan(0);
	});

	it('Discord 側で消されたものは、作り直す', async () => {
		const first = fakeBot();
		const { layout } = await ensureLayout(first.bot, EMPTY_LAYOUT);
		const errorsId = layout.channels.errors?.id;
		const { bot, created } = fakeBot({
			channels: (await first.bot.listChannels()).filter((c) => c.id !== errorsId),
			roles: await first.bot.listRoles(),
		});
		const next = await ensureLayout(bot, layout);
		expect(created).toEqual(['text:errors']);
		expect(next.layout.channels.errors?.id).not.toBe(errorsId);
	});

	it('管理者が置き換えたチャンネルは、作り直さず、そのまま残す', async () => {
		const { bot, created } = fakeBot();
		const manual = { ...EMPTY_LAYOUT, channels: { errors: { id: '555', managed: false } } };
		const { layout } = await ensureLayout(bot, manual);
		expect(layout.channels.errors).toEqual({ id: '555', managed: false });
		expect(created).not.toContain('text:errors');
	});
});

describe('parseLayout', () => {
	it('形の違う値は捨てる', () => {
		expect(parseLayout(null)).toEqual(EMPTY_LAYOUT);
		expect(
			parseLayout({
				category: { id: 'abc', managed: true },
				channels: { errors: { id: '5', managed: true }, deploy: { id: 5, managed: true } },
				roles: 'x',
			}),
		).toEqual({ category: null, channels: { errors: { id: '5', managed: true } }, roles: {} });
	});
});

describe('checkChannel', () => {
	it('別のギルドや、テキストでないチャンネルは、使えないとする', async () => {
		const { bot } = fakeBot({
			channels: [
				{ id: '1', name: 'a', type: 0, parentId: null, guildId: '111' },
				{ id: '2', name: 'b', type: 0, parentId: null, guildId: '222' },
				{ id: '3', name: 'c', type: 2, parentId: null, guildId: '111' },
			],
		});
		await expect(checkChannel(bot, '1')).resolves.toEqual({ ok: true });
		await expect(checkChannel(bot, '2')).resolves.toMatchObject({ ok: false });
		await expect(checkChannel(bot, '3')).resolves.toMatchObject({ ok: false });
		await expect(checkChannel(bot, '4')).resolves.toMatchObject({ ok: false });
	});
});
