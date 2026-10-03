import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DAILY_DIGEST_SETTINGS } from '@funmary/core';
import { createAuthStore } from './auth-store.ts';
import { createDailyDigestStore } from './daily-digest-store.ts';
import { openDatabase, type Database } from './database.ts';
import { createDiscordLinkStore } from './discord-link-store.ts';
import { createSecretBox, generateEncryptionKey } from './secrets.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-daily-digest-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const at = (iso: string) => new Date(iso);

function setup() {
	const auth = createAuthStore(database);
	const links = createDiscordLinkStore(database, createSecretBox(generateEncryptionKey()));
	const createUser = (name: string) =>
		auth.createUser(
			{ googleSub: name, email: `${name}@fun.ac.jp`, name: null, role: 'user' },
			at('2026-01-01T00:00:00Z'),
		);
	const link = (userId: string, channelId: string) =>
		links.save(
			userId,
			{
				discordUserId: `discord-${userId}`,
				accessToken: 'access',
				refreshToken: 'refresh',
				tokenExpiresAt: at('2026-02-01T00:00:00Z'),
				threadChannelId: null,
				dmChannelId: channelId,
				kindSettings: {},
			},
			at('2026-01-01T00:00:00Z'),
		);
	return { store: createDailyDigestStore(database), createUser, link };
}

describe('createDailyDigestStore', () => {
	it('設定を保存していなければ、既定の設定を返す', () => {
		const { store, createUser } = setup();
		expect(store.get(createUser('a'))).toEqual(DEFAULT_DAILY_DIGEST_SETTINGS);
	});

	it('設定を保存し、読み出せる。保存し直すと置き換わる', () => {
		const { store, createUser } = setup();
		const userId = createUser('a');
		const custom = {
			enabled: true,
			timing: 'custom',
			customTime: '07:15',
			customDay: 'today',
			sendWhenEmpty: false,
		} as const;
		store.save(userId, custom, at('2026-01-02T00:00:00Z'));
		expect(store.get(userId)).toEqual(custom);
		store.save(userId, { ...custom, enabled: false }, at('2026-01-03T00:00:00Z'));
		expect(store.get(userId).enabled).toBe(false);
	});

	it('送る相手は、Discord と連携している利用者だけ。設定と、前に送った日も返す', () => {
		const { store, createUser, link } = setup();
		const linked = createUser('linked');
		const configured = createUser('configured');
		createUser('unlinked');
		link(linked, 'dm-1');
		link(configured, 'dm-2');
		store.save(
			configured,
			{ ...DEFAULT_DAILY_DIGEST_SETTINGS, timing: 'morning' },
			at('2026-01-02T00:00:00Z'),
		);
		store.markSent(configured, '2026-01-02', at('2026-01-02T00:00:00Z'));

		expect(store.listRecipients().sort((a, b) => a.channelId.localeCompare(b.channelId))).toEqual([
			{
				userId: linked,
				channelId: 'dm-1',
				settings: DEFAULT_DAILY_DIGEST_SETTINGS,
				lastSentFor: null,
			},
			{
				userId: configured,
				channelId: 'dm-2',
				settings: { ...DEFAULT_DAILY_DIGEST_SETTINGS, timing: 'morning' },
				lastSentFor: '2026-01-02',
			},
		]);
	});

	it('送り先 (スレッドか DM) が今は無い人には送らない', () => {
		const { store, createUser, link } = setup();
		const linked = createUser('linked');
		const noChannel = createUser('no-channel');
		link(linked, 'dm-1');
		link(noChannel, 'dm-2');
		const links = createDiscordLinkStore(database, createSecretBox(generateEncryptionKey()));
		links.setChannel(noChannel, 'dm', null);

		expect(store.listRecipients().map((r) => r.userId)).toEqual([linked]);
	});

	it('設定を保存していなくても、送った日を記録でき、設定は既定のまま', () => {
		const { store, createUser, link } = setup();
		const userId = createUser('a');
		link(userId, 'dm-1');
		store.markSent(userId, '2026-01-05', at('2026-01-04T11:30:00Z'));
		expect(store.listRecipients()[0]?.lastSentFor).toBe('2026-01-05');
		expect(store.get(userId)).toEqual(DEFAULT_DAILY_DIGEST_SETTINGS);
	});

	it('設定を保存し直しても、前に送った日は消えない', () => {
		const { store, createUser, link } = setup();
		const userId = createUser('a');
		link(userId, 'dm-1');
		store.markSent(userId, '2026-01-05', at('2026-01-04T11:30:00Z'));
		store.save(userId, DEFAULT_DAILY_DIGEST_SETTINGS, at('2026-01-04T12:00:00Z'));
		expect(store.listRecipients()[0]?.lastSentFor).toBe('2026-01-05');
	});
});
