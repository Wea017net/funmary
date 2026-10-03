import { describe, expect, it } from 'vitest';
import { parseAccessTokenId, parseAccessTokenIssue } from './access-token-form.ts';

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

describe('parseAccessTokenId', () => {
	it('正の整数だけを受け付ける', () => {
		expect(parseAccessTokenId(form({ id: '3' }))).toBe(3);
		expect(parseAccessTokenId(form({ id: '0' }))).toBeNull();
		expect(parseAccessTokenId(form({ id: 'abc' }))).toBeNull();
	});
});
