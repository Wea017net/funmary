import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthStore } from './auth-store.ts';
import { createChannelStore, type ChannelStore } from './channel-store.ts';
import { openDatabase, type Database } from './database.ts';
import { createDeliveryStore, type DeliveryStore } from './delivery-store.ts';
import { createDiscordLinkStore } from './discord-link-store.ts';
import { createNotificationStore, type NotificationStore } from './notification-store.ts';
import { createSecretBox, generateEncryptionKey } from './secrets.ts';

let dir: string;
let database: Database;
let channels: ChannelStore;
let deliveries: DeliveryStore;
let notifications: NotificationStore;

const secretBox = createSecretBox(generateEncryptionKey());
const at = (iso: string) => new Date(iso);
const URL_A = 'https://discord.com/api/webhooks/123/abc-DEF_1';

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-deliveries-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
	channels = createChannelStore(database, secretBox);
	deliveries = createDeliveryStore(database, secretBox);
	notifications = createNotificationStore(database);
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

function newUser(sub: string) {
	return createAuthStore(database).createUser(
		{ googleSub: sub, email: `${sub}@fun.ac.jp`, name: null, role: 'user' },
		at('2026-09-01T00:00:00Z'),
	);
}

function notify(userId: string, key: string, kind: 'cancellation' | 'notice' = 'cancellation') {
	const [id] = notifications.insertMany(
		[
			{
				userId,
				kind,
				title: `[休講] ${key}`,
				body: null,
				link: null,
				subjectId: null,
				dedupeKey: key,
			},
		],
		at('2026-10-01T00:00:00Z'),
	);
	return id!;
}

function link(userId: string, destination: 'dm' | 'thread' = 'dm', channelId = '999') {
	createDiscordLinkStore(database, secretBox).save(
		userId,
		{
			discordUserId: `d-${userId}`,
			accessToken: 't',
			refreshToken: 'r',
			tokenExpiresAt: at('2026-12-01T00:00:00Z'),
			destination,
			channelId,
		},
		at('2026-09-30T00:00:00Z'),
	);
}

describe('Webhook のチャネル', () => {
	it('URL を暗号化して保存し、読むと元の URL に戻る。数えられ、本人の分だけ返る', () => {
		const a = newUser('a');
		const b = newUser('b');
		const channel = channels.addWebhook(
			a,
			{ url: URL_A, label: '自分のサーバー', notificationKinds: ['cancellation'] },
			at('2026-10-01T00:00:00Z'),
		);
		expect(channel.url).toBe(URL_A);
		expect(channel.status).toBe('active');
		const raw = database.sqlite.prepare('SELECT config_encrypted FROM channels').get() as {
			config_encrypted: string;
		};
		expect(raw.config_encrypted).not.toContain('discord.com');
		expect(channels.listWebhooks(a)).toHaveLength(1);
		expect(channels.listWebhooks(b)).toHaveLength(0);
		expect(channels.countWebhooks(a)).toBe(1);
		expect(channels.findWebhook(b, channel.id)).toBeNull();
	});

	it('更新で、名前、種類、ON と OFF を変えられる。ON に戻すと止めた理由が消える', () => {
		const a = newUser('a');
		const { id } = channels.addWebhook(
			a,
			{ url: URL_A, label: null, notificationKinds: ['cancellation'] },
			at('2026-10-01T00:00:00Z'),
		);
		channels.disable(id, 'Webhook が削除されました');
		expect(channels.findWebhook(a, id)).toMatchObject({
			status: 'disabled',
			disabledReason: 'Webhook が削除されました',
		});
		const updated = channels.updateWebhook(a, id, {
			label: '共有',
			notificationKinds: ['makeup', 'roomChange'],
			enabled: true,
		});
		expect(updated).toMatchObject({
			label: '共有',
			notificationKinds: ['makeup', 'roomChange'],
			status: 'active',
			disabledReason: null,
		});
		expect(channels.updateWebhook(newUser('b'), id, { enabled: false })).toBeNull();
	});

	it('削除すると、数えなくなる。ほかの人の分は消せない', () => {
		const a = newUser('a');
		const { id } = channels.addWebhook(
			a,
			{ url: URL_A, label: null, notificationKinds: null },
			at('2026-10-01T00:00:00Z'),
		);
		expect(channels.removeWebhook(newUser('b'), id)).toBe(false);
		expect(channels.removeWebhook(a, id)).toBe(true);
		expect(channels.countWebhooks(a)).toBe(0);
	});
});

describe('Discord 連携の送り先', () => {
	it('連携した人にだけ作り、連携を解除した人の分は消す。何度呼んでも同じ', () => {
		const a = newUser('a');
		newUser('b');
		link(a);
		channels.syncLinkChannels(at('2026-10-01T00:00:00Z'));
		channels.syncLinkChannels(at('2026-10-01T00:00:00Z'));
		const count = () =>
			(
				database.sqlite
					.prepare("SELECT count(*) AS n FROM channels WHERE kind = 'discordLink'")
					.get() as { n: number }
			).n;
		expect(count()).toBe(1);
		expect(channels.listWebhooks(a)).toHaveLength(0);
		createDiscordLinkStore(database, secretBox).remove(a);
		channels.syncLinkChannels(at('2026-10-01T00:00:00Z'));
		expect(count()).toBe(0);
	});
});

describe('Discord 連携の送り先の復帰', () => {
	it('止めたあとに連携し直したら、有効に戻す。連携し直していなければ戻さない', () => {
		const a = newUser('a');
		link(a);
		channels.syncLinkChannels(at('2026-10-01T00:00:00Z'));
		const id = (
			database.sqlite.prepare("SELECT id FROM channels WHERE kind = 'discordLink'").get() as {
				id: number;
			}
		).id;
		channels.disable(id, '送り先に送れません');
		channels.syncLinkChannels(at('2026-10-02T00:00:00Z'));
		const status = () =>
			(
				database.sqlite.prepare('SELECT status FROM channels WHERE id = ?').get(id) as {
					status: string;
				}
			).status;
		expect(status()).toBe('disabled');
		createDiscordLinkStore(database, secretBox).save(
			a,
			{
				discordUserId: 'd-a',
				accessToken: 't',
				refreshToken: 'r',
				tokenExpiresAt: at('2026-12-01T00:00:00Z'),
				destination: 'dm',
				channelId: '1000',
			},
			at('2026-10-03T00:00:00Z'),
		);
		channels.syncLinkChannels(at('2026-10-03T00:00:01Z'));
		expect(status()).toBe('active');
	});
});

describe('送信待ち', () => {
	it('通知を、送る種類に合う有効なチャネルごとに 1 回だけ作る', () => {
		const a = newUser('a');
		channels.addWebhook(
			a,
			{ url: URL_A, label: null, notificationKinds: ['cancellation'] },
			at('2026-09-30T00:00:00Z'),
		);
		const off = channels.addWebhook(
			a,
			{ url: 'https://discord.com/api/webhooks/456/zzz', label: null, notificationKinds: null },
			at('2026-09-30T00:00:00Z'),
		);
		channels.updateWebhook(a, off.id, { enabled: false });
		notify(a, 'k1');
		notify(a, 'k2', 'notice');
		const now = at('2026-10-01T00:01:00Z');
		expect(deliveries.enqueueMissing(now)).toBe(1);
		expect(deliveries.enqueueMissing(now)).toBe(0);
		const due = deliveries.claimDue(now, 10);
		expect(due).toHaveLength(1);
		expect(due[0]).toMatchObject({
			attempts: 0,
			notification: { title: '[休講] k1', kind: 'cancellation' },
			target: { kind: 'webhook', url: URL_A },
		});
	});

	it('種類を決めていないチャネルには、休講、補講、教室変更、連携の不具合だけを送る', () => {
		const a = newUser('a');
		channels.addWebhook(
			a,
			{ url: URL_A, label: null, notificationKinds: null },
			at('2026-09-30T00:00:00Z'),
		);
		notify(a, 'k1');
		notify(a, 'k2', 'notice');
		expect(deliveries.enqueueMissing(at('2026-10-01T00:01:00Z'))).toBe(1);
	});

	it('チャネルを足す前にあった通知は、そのチャネルに送らない', () => {
		const a = newUser('a');
		notify(a, 'old');
		channels.addWebhook(
			a,
			{ url: URL_A, label: null, notificationKinds: null },
			at('2026-10-01T00:30:00Z'),
		);
		expect(deliveries.enqueueMissing(at('2026-10-01T01:00:00Z'))).toBe(0);
	});

	it('作ってから 1 日より古い通知は、取りこぼしていても送らない', () => {
		const a = newUser('a');
		channels.addWebhook(
			a,
			{ url: URL_A, label: null, notificationKinds: null },
			at('2026-09-01T00:00:00Z'),
		);
		notify(a, 'old');
		expect(deliveries.enqueueMissing(at('2026-10-03T00:00:00Z'))).toBe(0);
	});

	it('Discord 連携の送り先には、連携の送り先を添える。連携がなくなっていれば target は null', () => {
		const a = newUser('a');
		link(a, 'thread', '777');
		channels.syncLinkChannels(at('2026-09-30T00:00:00Z'));
		notify(a, 'k1');
		const now = at('2026-10-01T00:01:00Z');
		deliveries.enqueueMissing(now);
		expect(deliveries.claimDue(now, 10)[0]?.target).toEqual({ kind: 'link', channelId: '777' });
		createDiscordLinkStore(database, secretBox).remove(a);
		expect(deliveries.claimDue(now, 10)[0]?.target).toBeNull();
	});

	it('送れたら済みにし、再送は次の時刻まで待ち、尽きたら失敗にする', () => {
		const a = newUser('a');
		channels.addWebhook(
			a,
			{ url: URL_A, label: null, notificationKinds: null },
			at('2026-09-30T00:00:00Z'),
		);
		notify(a, 'k1');
		notify(a, 'k2');
		const now = at('2026-10-01T00:01:00Z');
		deliveries.enqueueMissing(now);
		const [first, second] = deliveries.claimDue(now, 10);
		deliveries.markSent(first!.id, now);
		deliveries.markRetry(second!.id, {
			attempts: 1,
			nextAttemptAt: at('2026-10-01T00:06:00Z'),
			error: 'HTTP 500',
		});
		expect(deliveries.claimDue(at('2026-10-01T00:05:00Z'), 10)).toHaveLength(0);
		const again = deliveries.claimDue(at('2026-10-01T00:06:00Z'), 10);
		expect(again).toHaveLength(1);
		expect(again[0]?.attempts).toBe(1);
		deliveries.markFailed(second!.id, 'HTTP 500');
		expect(deliveries.claimDue(at('2026-10-02T00:00:00Z'), 10)).toHaveLength(0);
	});

	it('チャネルを止めると、送っていない分は失敗にして、もう送らない', () => {
		const a = newUser('a');
		const channel = channels.addWebhook(
			a,
			{ url: URL_A, label: null, notificationKinds: null },
			at('2026-09-30T00:00:00Z'),
		);
		notify(a, 'k1');
		notify(a, 'k2');
		const now = at('2026-10-01T00:01:00Z');
		deliveries.enqueueMissing(now);
		channels.disable(channel.id, '止めた');
		expect(deliveries.claimDue(now, 10)).toHaveLength(0);
		const rows = database.sqlite
			.prepare('SELECT status, last_error FROM deliveries ORDER BY id')
			.all() as { status: string; last_error: string }[];
		expect(rows).toEqual([
			{ status: 'failed', last_error: '止めた' },
			{ status: 'failed', last_error: '止めた' },
		]);
	});

	it('成功で、続けて失敗した数は途切れる', () => {
		const a = newUser('a');
		const channel = channels.addWebhook(
			a,
			{ url: URL_A, label: null, notificationKinds: null },
			at('2026-09-30T00:00:00Z'),
		);
		for (const key of ['k1', 'k2', 'k3']) notify(a, key);
		const now = at('2026-10-01T00:01:00Z');
		deliveries.enqueueMissing(now);
		const [x, y, z] = deliveries.claimDue(now, 10);
		deliveries.markFailed(x!.id, 'e');
		expect(deliveries.failureStreak(channel.id)).toBe(1);
		deliveries.markSent(y!.id, at('2026-10-01T00:02:00Z'));
		deliveries.markFailed(z!.id, 'e');
		expect(deliveries.failureStreak(channel.id)).toBe(1);
	});
});
