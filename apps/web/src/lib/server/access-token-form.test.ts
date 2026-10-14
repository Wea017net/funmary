import { describe, expect, it } from 'vitest';
import { READ_SCOPES } from '@funmary/db';
import {
	ACCESS_TOKEN_SCOPE_OPTIONS,
	parseAccessTokenId,
	parseAccessTokenIssue,
} from './access-token-form.ts';

const NOW = new Date('2026-10-04T00:00:00Z');

const form = (entries: Record<string, string | string[]>) => {
	const data = new FormData();
	for (const [key, value] of Object.entries(entries)) {
		for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
	}
	return data;
};

describe('parseAccessTokenIssue', () => {
	it('名前、範囲、有効期限を読む', () => {
		const result = parseAccessTokenIssue(
			form({
				name: ' 手元のスクリプト ',
				scopes: ['read:lessons', 'read:changes'],
				expiresInDays: '90',
			}),
			NOW,
		);
		expect(result).toMatchObject({
			ok: true,
			name: '手元のスクリプト',
			scopes: ['read:lessons', 'read:changes'],
		});
		if (result.ok) {
			expect(result.expiresAt.getTime() - NOW.getTime()).toBe(90 * 24 * 60 * 60 * 1000);
		}
	});

	it('名前がない、長すぎる、範囲が空、知らない範囲、期限が範囲外なら断る', () => {
		expect(
			parseAccessTokenIssue(form({ name: '', scopes: ['read:lessons'], expiresInDays: '90' }), NOW),
		).toMatchObject({ ok: false });
		expect(
			parseAccessTokenIssue(
				form({ name: 'a'.repeat(51), scopes: ['read:lessons'], expiresInDays: '90' }),
				NOW,
			),
		).toMatchObject({ ok: false });
		expect(
			parseAccessTokenIssue(form({ name: 'test', scopes: [], expiresInDays: '90' }), NOW),
		).toMatchObject({ ok: false });
		expect(
			parseAccessTokenIssue(
				form({ name: 'test', scopes: ['read:everything'], expiresInDays: '90' }),
				NOW,
			),
		).toMatchObject({ ok: false });
		expect(
			parseAccessTokenIssue(
				form({ name: 'test', scopes: ['read:lessons'], expiresInDays: '0' }),
				NOW,
			),
		).toMatchObject({ ok: false });
		expect(
			parseAccessTokenIssue(
				form({ name: 'test', scopes: ['read:lessons'], expiresInDays: '400' }),
				NOW,
			),
		).toMatchObject({ ok: false });
	});
});

describe('書き込みの範囲', () => {
	it('書き込みの範囲だけを選んでも、発行できる', () => {
		expect(
			parseAccessTokenIssue(
				form({ name: '予定の登録', scopes: ['write:events'], expiresInDays: '30' }),
				NOW,
			),
		).toMatchObject({ ok: true, scopes: ['write:events'] });
	});

	it('範囲が空のときの文は、読み取りに限らない', () => {
		expect(
			parseAccessTokenIssue(form({ name: 'test', scopes: [], expiresInDays: '90' }), NOW),
		).toEqual({ ok: false, error: '許可する範囲を、1 つ以上選んでください。' });
	});

	it('選択肢は、読み取りと書き込みを分ける。書き込みは、既定ではオフにするための印が付く', () => {
		const reads = ACCESS_TOKEN_SCOPE_OPTIONS.filter((option) => !option.write);
		const writes = ACCESS_TOKEN_SCOPE_OPTIONS.filter((option) => option.write);

		expect(reads.map((option) => option.scope)).toEqual([...READ_SCOPES]);
		expect(writes.map((option) => option.scope)).toEqual(['write:events', 'write:notifications']);
	});
});

describe('parseAccessTokenId', () => {
	it('正の整数だけを受け付ける', () => {
		expect(parseAccessTokenId(form({ id: '3' }))).toBe(3);
		expect(parseAccessTokenId(form({ id: '0' }))).toBeNull();
		expect(parseAccessTokenId(form({ id: 'abc' }))).toBeNull();
	});
});
