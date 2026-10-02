import { Webhook } from 'standardwebhooks';
import { describe, expect, it } from 'vitest';
import { generateSigningKey, signWebhook, verifyWebhookSignature } from './webhook-signature.ts';

const KEY = generateSigningKey();
const TIMESTAMP = new Date('2026-10-01T00:00:00Z');
const BODY = JSON.stringify({ id: 'ntf_1', type: 'class.cancelled' });

describe('鍵', () => {
	it('whsec_ で始まり、毎回違う値を作る', () => {
		expect(KEY).toMatch(/^whsec_/);
		expect(generateSigningKey()).not.toBe(KEY);
	});
});

describe('signWebhook', () => {
	it('Standard Webhooks の 3 つのヘッダを作る', () => {
		const headers = signWebhook({ id: 'ntf_1', timestamp: TIMESTAMP, body: BODY, signingKey: KEY });
		expect(headers['webhook-id']).toBe('ntf_1');
		expect(headers['webhook-timestamp']).toBe('1790812800');
		expect(headers['webhook-signature']).toMatch(/^v1,[\w+/=]+$/);
	});

	it('同じ入力なら、いつも同じ署名になる', () => {
		const a = signWebhook({ id: 'ntf_1', timestamp: TIMESTAMP, body: BODY, signingKey: KEY });
		const b = signWebhook({ id: 'ntf_1', timestamp: TIMESTAMP, body: BODY, signingKey: KEY });
		expect(a).toEqual(b);
	});

	it('ID、時刻、本文、鍵のどれかが変われば、署名も変わる', () => {
		const base = signWebhook({ id: 'ntf_1', timestamp: TIMESTAMP, body: BODY, signingKey: KEY });
		const byId = signWebhook({ id: 'ntf_2', timestamp: TIMESTAMP, body: BODY, signingKey: KEY });
		const byTime = signWebhook({
			id: 'ntf_1',
			timestamp: new Date(TIMESTAMP.getTime() + 1000),
			body: BODY,
			signingKey: KEY,
		});
		const byBody = signWebhook({ id: 'ntf_1', timestamp: TIMESTAMP, body: '{}', signingKey: KEY });
		const byKey = signWebhook({
			id: 'ntf_1',
			timestamp: TIMESTAMP,
			body: BODY,
			signingKey: generateSigningKey(),
		});
		const signatures = [base, byId, byTime, byBody, byKey].map((h) => h['webhook-signature']);
		expect(new Set(signatures).size).toBe(5);
	});

	// 公式の Standard Webhooks のライブラリが、この署名をそのまま検証できることを確かめる (設計書 14.3.1)。
	// 公式ライブラリは「今から 5 分以上ずれた時刻」を断るので、ここだけは今の時刻を使う
	it('公式の standardwebhooks ライブラリで検証が通る', () => {
		const now = new Date();
		const headers = signWebhook({ id: 'ntf_1', timestamp: now, body: BODY, signingKey: KEY });
		const webhook = new Webhook(KEY);
		expect(() => webhook.verify(BODY, headers)).not.toThrow();
		expect(webhook.verify(BODY, headers)).toEqual(JSON.parse(BODY));
	});

	// 逆方向: 公式ライブラリで署名したものを、こちらの verifyWebhookSignature で検証できることも確かめる
	it('公式ライブラリの署名を、こちらの検証でも確かめられる', () => {
		const webhook = new Webhook(KEY);
		const signature = webhook.sign('ntf_1', TIMESTAMP, BODY);
		expect(
			verifyWebhookSignature(
				{
					id: 'ntf_1',
					timestampSeconds: Math.floor(TIMESTAMP.getTime() / 1000),
					body: BODY,
					signingKey: KEY,
				},
				signature,
			),
		).toBe(true);
	});
});

describe('verifyWebhookSignature', () => {
	const timestampSeconds = Math.floor(TIMESTAMP.getTime() / 1000);

	it('正しい署名を受け入れる', () => {
		const { 'webhook-signature': signature } = signWebhook({
			id: 'ntf_1',
			timestamp: TIMESTAMP,
			body: BODY,
			signingKey: KEY,
		});
		expect(
			verifyWebhookSignature(
				{ id: 'ntf_1', timestampSeconds, body: BODY, signingKey: KEY },
				signature,
			),
		).toBe(true);
	});

	it('書き換えられた本文や、違う鍵の署名を断る', () => {
		const { 'webhook-signature': signature } = signWebhook({
			id: 'ntf_1',
			timestamp: TIMESTAMP,
			body: BODY,
			signingKey: KEY,
		});
		expect(
			verifyWebhookSignature(
				{ id: 'ntf_1', timestampSeconds, body: '{"tampered":true}', signingKey: KEY },
				signature,
			),
		).toBe(false);
		expect(
			verifyWebhookSignature(
				{ id: 'ntf_1', timestampSeconds, body: BODY, signingKey: generateSigningKey() },
				signature,
			),
		).toBe(false);
	});

	it('スペース区切りで複数の署名が並んでいても、合うものがあれば受け入れる', () => {
		const { 'webhook-signature': signature } = signWebhook({
			id: 'ntf_1',
			timestamp: TIMESTAMP,
			body: BODY,
			signingKey: KEY,
		});
		expect(
			verifyWebhookSignature(
				{ id: 'ntf_1', timestampSeconds, body: BODY, signingKey: KEY },
				`v1,dummy ${signature}`,
			),
		).toBe(true);
	});
});
