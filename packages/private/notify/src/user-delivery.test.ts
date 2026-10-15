import { describe, expect, it, vi } from 'vitest';
import { DiscordApiError, type DiscordBot } from './discord-bot.ts';
import {
	discordEmbed,
	isDiscordWebhookUrl,
	maskWebhookUrl,
	sendViaBot,
	sendViaWebhook,
	type DeliveryMessage,
} from './user-delivery.ts';

const URL_OK = 'https://discord.com/api/webhooks/123456/abc-DEF_1';
const message: DeliveryMessage = {
	kind: 'cancellation',
	title: '[休講] 情報処理演習 (10/3 2 限)',
	body: null,
	url: 'https://funmary.example.com/app/subjects/2026/100201',
	createdAt: new Date('2026-10-01T00:00:00Z'),
};

describe('Webhook の URL', () => {
	it('Discord の Webhook の URL だけを受け付ける', () => {
		expect(isDiscordWebhookUrl(URL_OK)).toBe(true);
		expect(isDiscordWebhookUrl('https://discordapp.com/api/webhooks/1/x')).toBe(true);
		expect(isDiscordWebhookUrl('http://discord.com/api/webhooks/1/x')).toBe(false);
		expect(isDiscordWebhookUrl('https://example.com/api/webhooks/1/x')).toBe(false);
		expect(isDiscordWebhookUrl('https://discord.com.evil.example/api/webhooks/1/x')).toBe(false);
		expect(isDiscordWebhookUrl('https://discord.com/api/webhooks/1/x?thread_id=2')).toBe(false);
		expect(isDiscordWebhookUrl('')).toBe(false);
	});

	it('画面に出すときは、末尾を伏せる', () => {
		expect(maskWebhookUrl(URL_OK)).toBe('https://discord.com/api/webhooks/123456/…');
		expect(maskWebhookUrl(URL_OK)).not.toContain('abc');
	});

	it('Discord の形でない URL は、オリジンだけ見せる (汎用の Webhook)', () => {
		expect(maskWebhookUrl('https://example.com/webhooks/funmary?token=secret')).toBe(
			'https://example.com/…',
		);
		expect(maskWebhookUrl('https://example.com/webhooks/funmary?token=secret')).not.toContain(
			'secret',
		);
		expect(maskWebhookUrl('not a url')).toBe('…');
	});
});

describe('埋め込み', () => {
	it('種類で色を分け、題と時刻とリンクを入れる', () => {
		const red = discordEmbed(message);
		expect(red).toMatchObject({
			title: message.title,
			url: message.url,
			timestamp: '2026-10-01T00:00:00.000Z',
		});
		const green = discordEmbed({ ...message, kind: 'makeup' });
		const yellow = discordEmbed({ ...message, kind: 'roomChange' });
		expect(new Set([red.color, green.color, yellow.color]).size).toBe(3);
	});

	it('長すぎる題と本文は、Discord の上限に収める。リンクがなければ url を付けない', () => {
		const embed = discordEmbed({
			...message,
			title: 'あ'.repeat(500),
			body: 'い'.repeat(5000),
			url: null,
		});
		expect(embed.title!.length).toBeLessThanOrEqual(256);
		expect(embed.description!.length).toBeLessThanOrEqual(4096);
		expect(embed).not.toHaveProperty('url');
	});
});

const respond = (status: number, init: { headers?: Record<string, string>; body?: string } = {}) =>
	vi
		.fn()
		.mockResolvedValue(
			new Response(init.body ?? null, { status, ...(init.headers && { headers: init.headers }) }),
		);

describe('sendViaWebhook', () => {
	it('埋め込みを POST する。メンションは効かせない', async () => {
		const fetch = respond(204);
		await expect(sendViaWebhook(URL_OK, message, { fetch })).resolves.toEqual({ status: 'sent' });
		const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(URL_OK);
		expect(init.method).toBe('POST');
		const body = JSON.parse(init.body as string) as {
			allowed_mentions: unknown;
			embeds: unknown[];
		};
		expect(body.allowed_mentions).toEqual({ parse: [] });
		expect(body.embeds).toHaveLength(1);
	});

	it('404 と 401 は、Webhook が消えたとみなす', async () => {
		for (const status of [404, 401]) {
			const result = await sendViaWebhook(URL_OK, message, { fetch: respond(status) });
			expect(result.status).toBe('gone');
		}
	});

	it('429 は、Retry-After の秒数を待って再送する。ない場合は本文の retry_after を使う', async () => {
		await expect(
			sendViaWebhook(URL_OK, message, {
				fetch: respond(429, { headers: { 'retry-after': '3' } }),
			}),
		).resolves.toMatchObject({ status: 'retry', afterMs: 3000 });
		await expect(
			sendViaWebhook(URL_OK, message, {
				fetch: respond(429, { body: JSON.stringify({ retry_after: 1.5 }) }),
			}),
		).resolves.toMatchObject({ status: 'retry', afterMs: 1500 });
	});

	it('5xx と通信の失敗は、間隔を広げて再送する。ほかの 4xx は再送しても直らない', async () => {
		await expect(sendViaWebhook(URL_OK, message, { fetch: respond(503) })).resolves.toMatchObject({
			status: 'retry',
			afterMs: null,
		});
		await expect(
			sendViaWebhook(URL_OK, message, { fetch: vi.fn().mockRejectedValue(new Error('timeout')) }),
		).resolves.toMatchObject({ status: 'retry', afterMs: null });
		await expect(sendViaWebhook(URL_OK, message, { fetch: respond(400) })).resolves.toMatchObject({
			status: 'rejected',
		});
	});

	it('失敗の理由に URL を含めない', async () => {
		const result = await sendViaWebhook(URL_OK, message, {
			fetch: vi.fn().mockRejectedValue(new Error(`failed ${URL_OK}`)),
		});
		expect(JSON.stringify(result)).not.toContain('abc-DEF_1');
	});
});

describe('sendViaBot', () => {
	const botWith = (postEmbed: DiscordBot['postEmbed']) => ({ postEmbed }) as unknown as DiscordBot;

	it('送り先のチャンネルに埋め込みを送る', async () => {
		const postEmbed = vi.fn().mockResolvedValue(undefined);
		await expect(sendViaBot(botWith(postEmbed), '777', message)).resolves.toEqual({
			status: 'sent',
		});
		expect(postEmbed).toHaveBeenCalledWith(
			'777',
			expect.objectContaining({ title: message.title }),
			undefined,
		);
	});

	it('mentionUserId を渡すと、そのまま postEmbed に渡す', async () => {
		const postEmbed = vi.fn().mockResolvedValue(undefined);
		await sendViaBot(botWith(postEmbed), '777', message, 'discord-1');
		expect(postEmbed).toHaveBeenCalledWith('777', expect.anything(), 'discord-1');
	});

	it('送り先がなくなった (404、403) とみなす', async () => {
		for (const status of [404, 403]) {
			const postEmbed = vi.fn().mockRejectedValue(new DiscordApiError(status, 'x'));
			expect((await sendViaBot(botWith(postEmbed), '777', message)).status).toBe('gone');
		}
	});

	it('そのほかは、5xx なら再送、4xx なら再送しても直らない', async () => {
		await expect(
			sendViaBot(botWith(vi.fn().mockRejectedValue(new DiscordApiError(500, 'x'))), '7', message),
		).resolves.toMatchObject({ status: 'retry' });
		await expect(
			sendViaBot(botWith(vi.fn().mockRejectedValue(new DiscordApiError(400, 'x'))), '7', message),
		).resolves.toMatchObject({ status: 'rejected' });
		await expect(
			sendViaBot(botWith(vi.fn().mockRejectedValue(new Error('boom'))), '7', message),
		).resolves.toMatchObject({ status: 'retry' });
	});
});
