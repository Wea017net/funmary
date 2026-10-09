import type { PendingDelivery } from '@funmary/db';
import { createLogger } from '@funmary/log';
import type { DiscordBot } from '@funmary/notify';
import { describe, expect, it, vi } from 'vitest';
import { deliverNotificationsDeps, messageFor } from './notification-delivery.ts';

const log = createLogger({ level: 'error', format: 'text', mode: 'production' });
const ORIGIN = 'https://funmary.example.com';
const NOW = new Date('2026-10-01T00:00:00Z');

const delivery = (overrides: Partial<PendingDelivery> = {}): PendingDelivery => ({
	id: 1,
	attempts: 0,
	channelId: 10,
	userId: 'u1',
	channelKind: 'discord',
	notification: {
		id: 5,
		kind: 'cancellation',
		title: '[休講] 情報処理演習 (10/3 2 限)',
		body: null,
		link: '/app/subjects/2026/100201',
		subjectId: 42,
		date: '2026-10-03',
		period: 2,
		createdAt: NOW,
	},
	target: { kind: 'webhook', url: 'https://discord.com/api/webhooks/1/abc', signingKey: null },
	...overrides,
});

interface SetupOptions {
	dryRun?: boolean;
	bot?: DiscordBot | null;
	linkEnabled?: boolean;
	fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

function setup(items: PendingDelivery[], options: SetupOptions = {}) {
	const channels = { syncLinkChannels: vi.fn(), disable: vi.fn() };
	const deliveries = {
		enqueueMissing: vi.fn().mockReturnValue(2),
		claimDue: vi.fn().mockReturnValue(items),
		markSent: vi.fn(),
		markRetry: vi.fn(),
		markFailed: vi.fn(),
		failureStreak: vi.fn().mockReturnValue(0),
		recentFailed: vi.fn().mockReturnValue([]),
	};
	const notifications = { insertMany: vi.fn() };
	const subjects = { findById: vi.fn().mockReturnValue({ name: '情報処理演習' }) };
	const deps = deliverNotificationsDeps({
		channels: channels as never,
		deliveries: deliveries,
		notifications: notifications as never,
		subjects,
		bot: options.bot ?? null,
		origin: ORIGIN,
		dryRun: options.dryRun ?? false,
		linkEnabled: () => options.linkEnabled ?? true,
		termsVersion: '2026-10-03',
		log,
		...(options.fetch && { fetch: options.fetch }),
	});
	return { deps, channels, deliveries, notifications };
}

describe('通知の文面', () => {
	const subjects = { findById: vi.fn().mockReturnValue({ name: '情報処理演習' }) };

	it('リンクを絶対の URL にする', () => {
		expect(messageFor(delivery(), ORIGIN, subjects).url).toBe(`${ORIGIN}/app/subjects/2026/100201`);
		expect(
			messageFor(
				delivery({ notification: { ...delivery().notification, link: null } }),
				ORIGIN,
				subjects,
			).url,
		).toBeNull();
	});

	it('科目があれば、構造化データ (subject、date、period) を添える', () => {
		const message = messageFor(delivery(), ORIGIN, subjects);
		expect(subjects.findById).toHaveBeenCalledWith(42);
		expect(message.subject).toEqual({
			name: '情報処理演習',
			url: `${ORIGIN}/app/subjects/2026/100201`,
		});
		expect(message.date).toBe('2026-10-03');
		expect(message.period).toBe(2);
	});

	it('科目がない通知 (お知らせなど) には、構造化データを添えない', () => {
		const noSubjects = { findById: vi.fn() };
		const notice = delivery({
			notification: { ...delivery().notification, subjectId: null, date: null, period: null },
		});
		const message = messageFor(notice, ORIGIN, noSubjects);
		expect(noSubjects.findById).not.toHaveBeenCalled();
		expect(message.subject).toBeNull();
	});
});

describe('通知を送る定期処理の接続', () => {
	it('下ごしらえで、連携の送り先を整え、送信待ちを作る。連携が無効の間は整えない', () => {
		const on = setup([]);
		on.deps.prepare(NOW);
		expect(on.channels.syncLinkChannels).toHaveBeenCalledWith(NOW);
		expect(on.deliveries.enqueueMissing).toHaveBeenCalledWith(NOW);
		const off = setup([], { linkEnabled: false });
		off.deps.prepare(NOW);
		expect(off.channels.syncLinkChannels).not.toHaveBeenCalled();
	});

	it('連携が無効の間は、連携の送り先の配信を取り出さない', () => {
		const items = [delivery({ id: 1 }), delivery({ id: 2, channelKind: 'discordLink' })];
		const ids = (options: SetupOptions) =>
			setup(items, options)
				.deps.claim(NOW, 10)
				.map((item) => item.id);
		expect(ids({ linkEnabled: false })).toEqual([1]);
		expect(ids({})).toEqual([1, 2]);
	});

	it('配信を取り出すときは、いまの版の利用規約に同意した利用者の分だけにする', () => {
		const { deps, deliveries } = setup([]);

		deps.claim(NOW, 10);

		expect(deliveries.claimDue).toHaveBeenCalledWith(NOW, 10, { termsVersion: '2026-10-03' });
	});

	it('Webhook には埋め込みを POST する', async () => {
		const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
		const { deps } = setup([delivery()], { fetch });
		const [item] = deps.claim(NOW, 10);
		await expect(deps.send(item)).resolves.toEqual({ status: 'sent' });
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('署名の鍵がある送り先には、Funmary 共通の JSON を署名して送る (汎用の Webhook)', async () => {
		const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
		const generic = delivery({
			channelKind: 'generic',
			target: { kind: 'webhook', url: 'https://example.com/hook', signingKey: 'whsec_abc' },
		});
		const { deps } = setup([generic], { fetch });
		const [item] = deps.claim(NOW, 10);
		await expect(deps.send(item)).resolves.toEqual({ status: 'sent' });
		const [, init] = fetch.mock.calls[0] as [
			string,
			RequestInit & { headers: Record<string, string> },
		];
		expect(init.headers['webhook-signature']).toMatch(/^v1,/);
		expect(JSON.parse(init.body as string)).toMatchObject({
			id: `ntf_${generic.notification.id}`,
			type: 'class.cancelled',
		});
	});

	it('Discord 連携の送り先には、Bot で送る。Bot がなければ再送を待つ', async () => {
		const postEmbed = vi.fn().mockResolvedValue(undefined);
		const link = delivery({
			channelKind: 'discordLink',
			target: { kind: 'link', destinations: [{ channelId: '777', mentionUserId: null }] },
		});
		const withBot = setup([link], { bot: { postEmbed } as unknown as DiscordBot });
		await expect(withBot.deps.send(withBot.deps.claim(NOW, 10)[0])).resolves.toEqual({
			status: 'sent',
		});
		expect(postEmbed).toHaveBeenCalledWith(
			'777',
			expect.objectContaining({ title: link.notification.title }),
			undefined,
		);
		const noBot = setup([link]);
		await expect(noBot.deps.send(noBot.deps.claim(NOW, 10)[0])).resolves.toMatchObject({
			status: 'retry',
		});
	});

	it('両方 (スレッドと DM) に送る設定なら、2 件に送る。メンションする相手も渡す', async () => {
		const postEmbed = vi.fn().mockResolvedValue(undefined);
		const both = delivery({
			channelKind: 'discordLink',
			target: {
				kind: 'link',
				destinations: [
					{ channelId: 'thread-1', mentionUserId: 'discord-1' },
					{ channelId: 'dm-1', mentionUserId: null },
				],
			},
		});
		const { deps } = setup([both], { bot: { postEmbed } as unknown as DiscordBot });
		await expect(deps.send(deps.claim(NOW, 10)[0])).resolves.toEqual({ status: 'sent' });
		expect(postEmbed).toHaveBeenCalledTimes(2);
		expect(postEmbed).toHaveBeenCalledWith('thread-1', expect.anything(), 'discord-1');
		expect(postEmbed).toHaveBeenCalledWith('dm-1', expect.anything(), undefined);
	});

	it('NOTIFY_DRY_RUN のときは、送らずに送れたことにする', async () => {
		const fetch = vi.fn();
		const { deps } = setup([delivery()], { dryRun: true, fetch });
		await expect(deps.send(deps.claim(NOW, 10)[0])).resolves.toEqual({ status: 'sent' });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('連携の不具合は、通知欄に足す', () => {
		const { deps, notifications } = setup([]);
		const notice = {
			userId: 'u1',
			kind: 'integration' as const,
			title: 't',
			body: 'b',
			link: '/app/settings/webhooks',
			subjectId: null,
			dedupeKey: 'k',
		};
		deps.notifyUser(notice, NOW);
		expect(notifications.insertMany).toHaveBeenCalledWith([notice], NOW);
	});
});
