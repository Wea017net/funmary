import { describe, expect, it } from 'vitest';
import { DEFAULT_WEBHOOK_LIMIT, parseWebhookLimit, readWebhookLimit } from './webhook-limit.ts';

describe('Webhook の個数の上限', () => {
	it('保存がなければ、既定の 5 個。0 も有効な値', () => {
		expect(readWebhookLimit(null)).toBe(DEFAULT_WEBHOOK_LIMIT);
		expect(DEFAULT_WEBHOOK_LIMIT).toBe(5);
		expect(readWebhookLimit({ limit: 0 })).toBe(0);
		expect(readWebhookLimit({ limit: 12 })).toBe(12);
	});

	it('形が違う値や、範囲を外れた値は、既定の個数にする', () => {
		for (const value of [{ limit: -1 }, { limit: 1.5 }, { limit: '3' }, { limit: 999 }, 'x', {}]) {
			expect(readWebhookLimit(value)).toBe(DEFAULT_WEBHOOK_LIMIT);
		}
	});

	it('フォームは 0 から 50 までの整数だけ受け付ける', () => {
		expect(parseWebhookLimit('0')).toBe(0);
		expect(parseWebhookLimit(' 50 ')).toBe(50);
		for (const value of ['51', '-1', '1.5', '', 'abc', null]) {
			expect(parseWebhookLimit(value)).toBeNull();
		}
	});
});
