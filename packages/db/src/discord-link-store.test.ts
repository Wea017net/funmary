import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthStore } from './auth-store.ts';
import { openDatabase, type Database } from './database.ts';
import { createDiscordLinkStore } from './discord-link-store.ts';
import { createSecretBox, generateEncryptionKey } from './secrets.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-discord-links-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const at = (iso: string) => new Date(iso);

const input = {
	discordUserId: 'discord-1',
	accessToken: 'access-token',
	refreshToken: 'refresh-token',
	tokenExpiresAt: at('2026-01-01T01:00:00Z'),
	destination: 'thread' as const,
	channelId: 'channel-1',
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
		expect(link?.destination).toBe('thread');
		expect(link?.channelId).toBe('channel-1');
	});

	it('紐付けがない利用者は null', () => {
		const { store, userId } = setup();
		expect(store.findByUser(userId)).toBeNull();
	});

	it('同じ利用者に保存し直すと、前の紐付けを置き換える (付け替え)', () => {
		const { store, userId } = setup();
		store.save(userId, input, at('2026-01-01T00:00:00Z'));
		store.save(
			userId,
			{ ...input, discordUserId: 'discord-2', channelId: 'channel-2' },
			at('2026-01-02T00:00:00Z'),
		);

		const link = store.findByUser(userId);
		expect(link?.discordUserId).toBe('discord-2');
		expect(link?.channelId).toBe('channel-2');
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

	describe('updateChannel', () => {
		it('送り先だけを変える。トークンはそのまま', () => {
			const { store, userId } = setup();
			store.save(userId, input, at('2026-01-01T00:00:00Z'));

			expect(store.updateChannel(userId, { destination: 'dm', channelId: 'dm-1' })).toBe(true);
			const link = store.findByUser(userId);
			expect(link).toMatchObject({
				destination: 'dm',
				channelId: 'dm-1',
				accessToken: 'access-token',
				discordUserId: 'discord-1',
			});
		});

		it('channelId に null を渡すと、送り先が無い状態にする', () => {
			const { store, userId } = setup();
			store.save(userId, input, at('2026-01-01T00:00:00Z'));

			store.updateChannel(userId, { destination: 'thread', channelId: null });
			expect(store.findByUser(userId)).toMatchObject({ destination: 'thread', channelId: null });
		});

		it('連携していない利用者には false', () => {
			const { store, userId } = setup();
			expect(store.updateChannel(userId, { destination: 'dm', channelId: 'dm-1' })).toBe(false);
		});
	});
});
