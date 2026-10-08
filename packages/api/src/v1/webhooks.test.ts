import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WEBHOOK_EVENT_TYPES } from './webhooks.ts';

describe('WEBHOOK_EVENT_TYPES', () => {
	it('type の一覧が、送る側 (packages/notify) の対応表と同じになる', () => {
		const source = readFileSync(
			new URL('../../../notify/src/generic-webhook.ts', import.meta.url),
			'utf8',
		);
		const sent = [...source.matchAll(/:\s*'([a-z_.]+)',\n/g)]
			.map((m) => m[1])
			.filter((name) => name !== undefined);
		const names = sent.filter((name) => (WEBHOOK_EVENT_TYPES as readonly string[]).includes(name));
		expect(new Set(names)).toEqual(new Set(WEBHOOK_EVENT_TYPES));
		const table = /TYPE_NAMES[\s\S]*?\{([\s\S]*?)\};/.exec(source)?.[1] ?? '';
		const inTable = [...table.matchAll(/:\s*'([a-z_.]+)'/g)].map((m) => m[1]);
		expect(inTable.sort()).toEqual([...WEBHOOK_EVENT_TYPES].sort());
	});
});
