import { createSecretBox, generateEncryptionKey, type DiscordLinkStore } from '@funmary/db';
import type { DiscordBot, DiscordOAuthClient } from '@funmary/notify';
import { describe, expect, it, vi } from 'vitest';
import {
	completeDiscordLink,
	openLinkState,
	sealLinkState,
	type DiscordLinkState,
} from './discord-link.ts';

const at = (iso: string) => new Date(iso);

describe('sealLinkState / openLinkState', () => {
	const box = createSecretBox(generateEncryptionKey());
	const state: DiscordLinkState = {
		userId: 'user-1',
		destination: 'thread',
		startedAt: at('2026-01-01T00:00:00Z').getTime(),
	};

	it('封じて開けると、元の値に戻る', () => {
		const sealed = sealLinkState(box, state);
		expect(openLinkState(box, sealed, at('2026-01-01T00:05:00Z'))).toEqual(state);
	});

	it('10 分たつと、期限切れで null になる', () => {
		const sealed = sealLinkState(box, state);
		expect(openLinkState(box, sealed, at('2026-01-01T00:10:01Z'))).toBeNull();
	});

	it('別の鍵で開けようとすると null になる', () => {
		const sealed = sealLinkState(box, state);
		const other = createSecretBox(generateEncryptionKey());
		expect(openLinkState(other, sealed, at('2026-01-01T00:00:00Z'))).toBeNull();
	});

	it('壊れた文字列は null になる', () => {
		expect(openLinkState(box, 'garbage', at('2026-01-01T00:00:00Z'))).toBeNull();
	});
});

function fakeOauth(overrides: Partial<DiscordOAuthClient> = {}): DiscordOAuthClient {
	return {
		authorizationUrl: () => 'https://discord.com/authorize',
		exchangeCode: () =>
			Promise.resolve({ accessToken: 'at', refreshToken: 'rt', expiresAt: at('2026-01-08') }),
		fetchCurrentUser: () => Promise.resolve({ id: 'discord-1', username: 'someone' }),
		revoke: () => Promise.resolve(),
		...overrides,
	};
}

function fakeBot(overrides: Partial<DiscordBot> = {}): DiscordBot {
	return {
		guildId: '111',
		me: () => Promise.resolve('999'),
		listChannels: () => Promise.resolve([]),
		listRoles: () => Promise.resolve([]),
		getChannel: () => Promise.resolve(null),
		postEmbed: () => Promise.resolve(),
		createRole: () => Promise.reject(new Error('unused')),
		createChannel: () => Promise.reject(new Error('unused')),
		addMemberRole: () => Promise.resolve(),
		removeMemberRole: () => Promise.resolve(),
		postMessage: () => Promise.resolve(),
		createDm: () => Promise.resolve('dm-1'),
		createPrivateThread: () => Promise.resolve('thread-1'),
		addThreadMember: () => Promise.resolve(),
		archiveThread: () => Promise.resolve(),
		deleteThread: () => Promise.resolve(),
		addGuildMember: () => Promise.resolve(),
		createInvite: () => Promise.resolve({ code: 'abc', expiresAt: null }),
		deleteInvite: () => Promise.resolve(),
		...overrides,
	};
}

function fakeStore(overrides: Partial<DiscordLinkStore> = {}): DiscordLinkStore {
	return {
		save: vi.fn(),
		findByUser: () => null,
		isDiscordUserLinkedToOther: () => false,
		remove: () => null,
		updateChannel: () => false,
		...overrides,
	};
}

const state: DiscordLinkState = { userId: 'user-1', destination: 'thread', startedAt: 0 };
const log = { warn: vi.fn() };

describe('completeDiscordLink', () => {
	it('スレッドを用意し、紐付けを保存する', async () => {
		const save = vi.fn();
		const store = fakeStore({ save });
		const bot = fakeBot();
		const result = await completeDiscordLink(
			{ oauth: fakeOauth(), bot, store, linksChannelId: 'support-1', joinRoleIds: [], log },
			{ code: 'code-1', state },
			at('2026-01-01'),
		);
		expect(result).toEqual({ ok: true, message: 'Discord と連携しました。' });
		expect(save).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({
				discordUserId: 'discord-1',
				destination: 'thread',
				channelId: 'thread-1',
			}),
			at('2026-01-01'),
		);
	});

	it('joinRoleIds を渡していれば、参加のときに付ける', async () => {
		const addGuildMember = vi.fn().mockResolvedValue(undefined);
		const bot = fakeBot({ addGuildMember });
		await completeDiscordLink(
			{
				oauth: fakeOauth(),
				bot,
				store: fakeStore(),
				linksChannelId: 'support-1',
				joinRoleIds: ['role-1'],
				log,
			},
			{ code: 'code-1', state },
			at('2026-01-01'),
		);
		expect(addGuildMember).toHaveBeenCalledWith('discord-1', 'at', ['role-1']);
	});

	it('DM を選んだときは、DM チャンネルを開く', async () => {
		const save = vi.fn();
		const store = fakeStore({ save });
		const result = await completeDiscordLink(
			{
				oauth: fakeOauth(),
				bot: fakeBot(),
				store,
				linksChannelId: 'support-1',
				joinRoleIds: [],
				log,
			},
			{ code: 'code-1', state: { ...state, destination: 'dm' } },
			at('2026-01-01'),
		);
		expect(result.ok).toBe(true);
		expect(save).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({ destination: 'dm', channelId: 'dm-1' }),
			at('2026-01-01'),
		);
	});

	it('Bot が設定されていなければ、失敗にする', async () => {
		const result = await completeDiscordLink(
			{
				oauth: fakeOauth(),
				bot: null,
				store: fakeStore(),
				linksChannelId: 'support-1',
				joinRoleIds: [],
				log,
			},
			{ code: 'code-1', state },
			at('2026-01-01'),
		);
		expect(result.ok).toBe(false);
	});

	it('別の利用者が同じ Discord アカウントに紐付いていれば、失敗にする', async () => {
		const store = fakeStore({ isDiscordUserLinkedToOther: () => true });
		const result = await completeDiscordLink(
			{
				oauth: fakeOauth(),
				bot: fakeBot(),
				store,
				linksChannelId: 'support-1',
				joinRoleIds: [],
				log,
			},
			{ code: 'code-1', state },
			at('2026-01-01'),
		);
		expect(result).toMatchObject({ ok: false });
		expect(result.message).toContain('別の利用者');
	});

	it('ギルドへの参加に失敗したら、紐付けを保存しない', async () => {
		const save = vi.fn();
		const store = fakeStore({ save });
		const bot = fakeBot({ addGuildMember: () => Promise.reject(new Error('403')) });
		const result = await completeDiscordLink(
			{ oauth: fakeOauth(), bot, store, linksChannelId: 'support-1', joinRoleIds: [], log },
			{ code: 'code-1', state },
			at('2026-01-01'),
		);
		expect(result.ok).toBe(false);
		expect(save).not.toHaveBeenCalled();
	});

	it('support チャンネルがまだなければ、スレッドを作らず失敗にする', async () => {
		const result = await completeDiscordLink(
			{
				oauth: fakeOauth(),
				bot: fakeBot(),
				store: fakeStore(),
				linksChannelId: null,
				joinRoleIds: [],
				log,
			},
			{ code: 'code-1', state },
			at('2026-01-01'),
		);
		expect(result.ok).toBe(false);
		expect(result.message).toContain('準備');
	});

	it('DM が開けなければ、失敗にする', async () => {
		const bot = fakeBot({ createDm: () => Promise.reject(new Error('403')) });
		const result = await completeDiscordLink(
			{
				oauth: fakeOauth(),
				bot,
				store: fakeStore(),
				linksChannelId: 'support-1',
				joinRoleIds: [],
				log,
			},
			{ code: 'code-1', state: { ...state, destination: 'dm' } },
			at('2026-01-01'),
		);
		expect(result.ok).toBe(false);
	});

	it('トークンの交換に失敗したら、失敗にする。中身はログに残す', async () => {
		log.warn.mockClear();
		const oauth = fakeOauth({ exchangeCode: () => Promise.reject(new Error('400')) });
		const result = await completeDiscordLink(
			{
				oauth,
				bot: fakeBot(),
				store: fakeStore(),
				linksChannelId: 'support-1',
				joinRoleIds: [],
				log,
			},
			{ code: 'code-1', state },
			at('2026-01-01'),
		);
		expect(result.ok).toBe(false);
		expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('400'));
	});
});
