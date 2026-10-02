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
		createdAt: NOW,
	},
	target: { kind: 'webhook', url: 'https://discord.com/api/webhooks/1/abc' },
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
	};
	const notifications = { insertMany: vi.fn() };
	const deps = deliverNotificationsDeps({
		channels: channels as never,
		deliveries: deliveries,
		notifications: notifications as never,
		bot: options.bot ?? null,
		origin: ORIGIN,
		dryRun: options.dryRun ?? false,
		linkEnabled: () => options.linkEnabled ?? true,
		log,
		...(options.fetch && { fetch: options.fetch }),
	});
	return { deps, channels, deliveries, notifications };
}

describe('通知の文面', () => {
	it('リンクを絶対の URL にする', () => {
		expect(messageFor(delivery(), ORIGIN).url).toBe(`${ORIGIN}/app/subjects/2026/100201`);
		expect(
			messageFor(delivery({ notification: { ...delivery().notification, link: null } }), ORIGIN)
				.url,
		).toBeNull();
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

	it('Webhook には埋め込みを POST する', async () => {
		const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
		const { deps } = setup([delivery()], { fetch });
		const [item] = deps.claim(NOW, 10);
		await expect(deps.send(item)).resolves.toEqual({ status: 'sent' });
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('Discord 連携の送り先には、Bot で送る。Bot がなければ再送を待つ', async () => {
		const postEmbed = vi.fn().mockResolvedValue(undefined);
		const link = delivery({
			channelKind: 'discordLink',
			target: { kind: 'link', channelId: '777' },
		});
		const withBot = setup([link], { bot: { postEmbed } as unknown as DiscordBot });
		await expect(withBot.deps.send(withBot.deps.claim(NOW, 10)[0])).resolves.toEqual({
			status: 'sent',
		});
		expect(postEmbed).toHaveBeenCalledWith(
			'777',
			expect.objectContaining({ title: link.notification.title }),
		);
		const noBot = setup([link]);
		await expect(noBot.deps.send(noBot.deps.claim(NOW, 10)[0])).resolves.toMatchObject({
			status: 'retry',
		});
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
