import { describe, expect, it, vi } from 'vitest';
import {
	genericWebhookBody,
	sendViaGenericWebhook,
	type GenericWebhookMessage,
} from './generic-webhook.ts';
import { generateSigningKey, verifyWebhookSignature } from './webhook-signature.ts';

const KEY = generateSigningKey();
const message: GenericWebhookMessage = {
	id: 'ntf_1',
	kind: 'cancellation',
	title: '[休講] 情報処理演習 (10/3 2 限)',
	body: null,
	url: 'https://funmary.example.com/app/subjects/2026/100201',
	createdAt: new Date('2026-10-01T00:00:00Z'),
};

const respond = (status: number, init: { headers?: Record<string, string>; body?: string } = {}) =>
	vi
		.fn()
		.mockResolvedValue(
			new Response(init.body ?? null, { status, ...(init.headers && { headers: init.headers }) }),
		);

describe('genericWebhookBody', () => {
	it('通知の種類を type にし、本文に title、body、url を入れる', () => {
		const body = JSON.parse(genericWebhookBody(message)) as Record<string, unknown>;
		expect(body).toMatchObject({
			id: 'ntf_1',
			type: 'class.cancelled',
			createdAt: '2026-10-01T00:00:00.000Z',
			data: { title: message.title, body: null, url: message.url },
		});
	});

	it('知らない種類は、そのまま type にする', () => {
		const body = JSON.parse(genericWebhookBody({ ...message, kind: 'something-new' })) as {
			type: string;
		};
		expect(body.type).toBe('something-new');
	});
});

describe('sendViaGenericWebhook', () => {
	it('https でない URL や、ポートが違う URL には送らない', async () => {
		const fetch = vi.fn();
		await expect(
			sendViaGenericWebhook('http://example.com/hook', message, KEY, { fetch }),
		).resolves.toMatchObject({ status: 'rejected' });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('署名したヘッダを付けて POST する。送った本文で署名の検証が通る', async () => {
		const fetch = respond(204);
		await expect(
			sendViaGenericWebhook('https://example.com/hook', message, KEY, { fetch }),
		).resolves.toEqual({ status: 'sent' });
		const [url, init] = fetch.mock.calls[0] as [
			string,
			RequestInit & { headers: Record<string, string> },
		];
		expect(url).toBe('https://example.com/hook');
		expect(init.method).toBe('POST');
		const body = init.body as string;
		expect(
			verifyWebhookSignature(
				{
					id: init.headers['webhook-id']!,
					timestampSeconds: Number(init.headers['webhook-timestamp']),
					body,
					signingKey: KEY,
				},
				init.headers['webhook-signature']!,
			),
		).toBe(true);
	});

	it('410 は、Webhook が使えなくなったとみなす', async () => {
		await expect(
			sendViaGenericWebhook('https://example.com/hook', message, KEY, { fetch: respond(410) }),
		).resolves.toMatchObject({ status: 'gone' });
	});

	it('429 は、Retry-After の秒数を待って再送する', async () => {
		await expect(
			sendViaGenericWebhook('https://example.com/hook', message, KEY, {
				fetch: respond(429, { headers: { 'retry-after': '3' } }),
			}),
		).resolves.toMatchObject({ status: 'retry', afterMs: 3000 });
	});

	it('410 と 429 以外の失敗 (400 や 500) は、再送する (Discord の Webhook と違い、断らない)', async () => {
		for (const status of [400, 404, 500]) {
			await expect(
				sendViaGenericWebhook('https://example.com/hook', message, KEY, { fetch: respond(status) }),
			).resolves.toMatchObject({ status: 'retry' });
		}
	});

	it('通信できなければ、再送する', async () => {
		await expect(
			sendViaGenericWebhook('https://example.com/hook', message, KEY, {
				fetch: vi.fn().mockRejectedValue(new Error('timeout')),
			}),
		).resolves.toMatchObject({ status: 'retry' });
	});
});
