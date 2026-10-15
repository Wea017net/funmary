import { describe, expect, it } from 'vitest';
import { createAuthStore } from './auth-store.ts';
import type { Database } from './database.ts';
import { createDiscordLinkStore, kindSetting } from './discord-link-store.ts';
import { createSecretBox, generateEncryptionKey } from './secrets.ts';
import { useTestDatabase } from './testing.ts';

let database: Database;
useTestDatabase('funmary-discord-links-', (db) => (database = db));

const at = (iso: string) => new Date(iso);

const input = {
	discordUserId: 'discord-1',
	accessToken: 'access-token',
	refreshToken: 'refresh-token',
	tokenExpiresAt: at('2026-01-01T01:00:00Z'),
	threadChannelId: 'channel-1',
	dmChannelId: null,
	kindSettings: {},
};

function setup() {
	const secretBox = createSecretBox(generateEncryptionKey());
	const store = createDiscordLinkStore(database, secretBox);
	const userId = createAuthStore(database).createUser(
		{ googleSub: 'u', email: 'u@fun.ac.jp', name: null, role: 'user' },
		at('2026-01-01T00:00:00Z'),
	);
	return { store, userId };
}

describe('createDiscordLinkStore', () => {
	it('保存した紐付けを、暗号化を解いて読み出せる', () => {
		const { store, userId } = setup();
		store.save(userId, input, at('2026-01-01T00:00:00Z'));

		const link = store.findByUser(userId);
		expect(link?.discordUserId).toBe('discord-1');
		expect(link?.accessToken).toBe('access-token');
		expect(link?.refreshToken).toBe('refresh-token');
		expect(link?.threadChannelId).toBe('channel-1');
		expect(link?.dmChannelId).toBeNull();
	});

	it('紐付けがない利用者は null', () => {
		const { store, userId } = setup();
		expect(store.findByUser(userId)).toBeNull();
	});

	it('Discord のユーザー ID から、紐付けた利用者を引ける。知らない ID なら null', () => {
		const { store, userId } = setup();
		store.save(userId, input, at('2026-01-01T00:00:00Z'));

		expect(store.findByDiscordUserId('discord-1')?.userId).toBe(userId);
		expect(store.findByDiscordUserId('unknown')).toBeNull();
	});

	it('同じ利用者に保存し直すと、前の紐付けを置き換える (付け替え)', () => {
		const { store, userId } = setup();
		store.save(userId, input, at('2026-01-01T00:00:00Z'));
		store.save(
			userId,
			{ ...input, discordUserId: 'discord-2', threadChannelId: 'channel-2' },
			at('2026-01-02T00:00:00Z'),
		);

		const link = store.findByUser(userId);
		expect(link?.discordUserId).toBe('discord-2');
		expect(link?.threadChannelId).toBe('channel-2');
	});

	it('別の利用者が同じ Discord アカウントに紐付いていれば true を返す', () => {
		const { store, userId } = setup();
		const other = createAuthStore(database).createUser(
			{ googleSub: 'o', email: 'o@fun.ac.jp', name: null, role: 'user' },
			at('2026-01-01T00:00:00Z'),
		);
		store.save(userId, input, at('2026-01-01T00:00:00Z'));

		expect(store.isDiscordUserLinkedToOther('discord-1', other)).toBe(true);
		expect(store.isDiscordUserLinkedToOther('discord-1', userId)).toBe(false);
		expect(store.isDiscordUserLinkedToOther('discord-unknown', other)).toBe(false);
	});

	it('解除すると消え、消したものを返す。なければ null', () => {
		const { store, userId } = setup();
		store.save(userId, input, at('2026-01-01T00:00:00Z'));

		const removed = store.remove(userId);
		expect(removed?.discordUserId).toBe('discord-1');
		expect(store.findByUser(userId)).toBeNull();
		expect(store.remove(userId)).toBeNull();
	});

	describe('setChannel', () => {
		it('片方のチャンネルだけを変える。トークンやもう片方には触れない', () => {
			const { store, userId } = setup();
			store.save(userId, input, at('2026-01-01T00:00:00Z'));

			expect(store.setChannel(userId, 'dm', 'dm-1')).toBe(true);
			const link = store.findByUser(userId);
			expect(link).toMatchObject({
				threadChannelId: 'channel-1',
				dmChannelId: 'dm-1',
				accessToken: 'access-token',
				discordUserId: 'discord-1',
			});
		});

		it('null を渡すと、その送り先が無い状態にする', () => {
			const { store, userId } = setup();
			store.save(userId, input, at('2026-01-01T00:00:00Z'));

			store.setChannel(userId, 'thread', null);
			expect(store.findByUser(userId)).toMatchObject({ threadChannelId: null });
		});

		it('連携していない利用者には false', () => {
			const { store, userId } = setup();
			expect(store.setChannel(userId, 'dm', 'dm-1')).toBe(false);
		});
	});

	describe('setKindSettings', () => {
		it('通知の種類ごとの設定を、まとめて置き換える', () => {
			const { store, userId } = setup();
			store.save(userId, input, at('2026-01-01T00:00:00Z'));

			const settings = {
				cancellation: { destination: 'dm' as const, mention: true },
				makeup: { destination: 'both' as const, mention: false },
			};
			expect(store.setKindSettings(userId, settings)).toBe(true);
			const link = store.findByUser(userId);
			expect(kindSetting(link!.kindSettings, 'cancellation')).toEqual({
				destination: 'dm',
				mention: true,
			});
			expect(kindSetting(link!.kindSettings, 'roomChange')).toEqual({
				destination: 'thread',
				mention: false,
			});
		});

		it('連携していない利用者には false', () => {
			const { store, userId } = setup();
			expect(store.setKindSettings(userId, {})).toBe(false);
		});
	});
});
