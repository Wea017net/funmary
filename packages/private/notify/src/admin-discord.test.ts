import { describe, expect, it } from 'vitest';
import { createAdminDiscordSink, defaultChannel, rolesToMention } from './admin-discord.ts';
import type { DiscordBot } from './discord-bot.ts';
import type { DiscordLayout } from './discord-layout.ts';

const layout: DiscordLayout = {
	category: { id: '1', managed: true },
	channels: {
		errors: { id: '20', managed: true },
		deploy: { id: '21', managed: true },
		other: { id: '29', managed: true },
	},
	roles: { errors: { id: '30', managed: true }, deploy: { id: '31', managed: true } },
};

function setup(current: DiscordLayout = layout, fail = false) {
	const posts: { channelId: string; content: string; roles: readonly string[] }[] = [];
	const bot = {
		postMessage: (channelId: string, content: string, roles: readonly string[] = []) => {
			if (fail) return Promise.reject(new Error('失敗'));
			posts.push({ channelId, content, roles });
			return Promise.resolve();
		},
	} as unknown as DiscordBot;
	return { sink: createAdminDiscordSink({ bot, layout: () => current }), posts };
}

describe('rolesToMention と defaultChannel', () => {
	it('errors は error のとき、deploy と subjects は失敗と警告のときだけ、ロールにメンションする', () => {
		expect(rolesToMention('errors', 'error')).toEqual(['errors']);
		expect(rolesToMention('errors', 'warn')).toEqual([]);
		expect(rolesToMention('deploy', 'warn')).toEqual(['deploy']);
		expect(rolesToMention('deploy', 'error')).toEqual(['deploy']);
		expect(rolesToMention('deploy', 'info')).toEqual([]);
		expect(rolesToMention('subjects', 'warn')).toEqual(['subjects']);
		expect(rolesToMention('subjects', 'info')).toEqual([]);
		expect(rolesToMention('users', 'error')).toEqual([]);
	});

	it('種類が無いときは、error なら errors、それ以外は sources にする', () => {
		expect(defaultChannel('error')).toBe('errors');
		expect(defaultChannel('warn')).toBe('sources');
		expect(defaultChannel('info')).toBe('sources');
	});
});

describe('createAdminDiscordSink', () => {
	it('チャンネルの ID に送り、メンションはそのロールにだけ効かせる', async () => {
		const { sink, posts } = setup();
		await expect(sink.post('errors', 'error', '**A**')).resolves.toBe(true);
		expect(posts).toEqual([{ channelId: '20', content: '<@&30>\n**A**', roles: ['30'] }]);
	});

	it('メンションが要らないときは、本文だけを送る', async () => {
		const { sink, posts } = setup();
		await sink.post('errors', 'warn', 'B');
		expect(posts).toEqual([{ channelId: '20', content: 'B', roles: [] }]);
	});

	it('そのチャンネルが決まっていなければ other に送り、other もなければ false', async () => {
		const { sink, posts } = setup();
		await sink.post('users', 'info', 'C');
		expect(posts[0]?.channelId).toBe('29');
		const empty = setup({ category: null, channels: {}, roles: {} });
		await expect(empty.sink.post('users', 'info', 'C')).resolves.toBe(false);
	});

	it('送れなかったら false を返し、例外にしない', async () => {
		const { sink } = setup(layout, true);
		await expect(sink.post('errors', 'error', 'D')).resolves.toBe(false);
	});
});
