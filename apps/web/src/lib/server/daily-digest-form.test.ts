import { DEFAULT_DAILY_DIGEST_SETTINGS } from '@funmary/core';
import { describe, expect, it } from 'vitest';
import { parseDailyDigestForm } from './daily-digest-form.ts';

const form = (entries: Record<string, string>) => {
	const data = new FormData();
	for (const [key, value] of Object.entries(entries)) data.set(key, value);
	return data;
};

describe('parseDailyDigestForm', () => {
	it('チェックのない欄は無効として読む', () => {
		expect(
			parseDailyDigestForm(form({ timing: 'morning' }), DEFAULT_DAILY_DIGEST_SETTINGS),
		).toEqual({
			ok: true,
			settings: {
				...DEFAULT_DAILY_DIGEST_SETTINGS,
				enabled: false,
				timing: 'morning',
				sendWhenEmpty: false,
			},
		});
	});

	it('カスタムなら、時刻と日を読む', () => {
		expect(
			parseDailyDigestForm(
				form({
					enabled: 'on',
					timing: 'custom',
					customHour: '07',
					customMinute: '15',
					customDay: 'today',
					sendWhenEmpty: 'on',
				}),
				DEFAULT_DAILY_DIGEST_SETTINGS,
			),
		).toEqual({
			ok: true,
			settings: {
				enabled: true,
				timing: 'custom',
				customTime: '07:15',
				customDay: 'today',
				sendWhenEmpty: true,
			},
		});
	});

	it('カスタムでなければ、送られてこない時刻と日は、前の値のまま', () => {
		const current = {
			...DEFAULT_DAILY_DIGEST_SETTINGS,
			customTime: '12:00',
			customDay: 'today' as const,
		};
		const result = parseDailyDigestForm(form({ enabled: 'on', timing: 'evening' }), current);
		expect(result).toMatchObject({
			ok: true,
			settings: { customTime: '12:00', customDay: 'today' },
		});
	});

	it('時刻が 5 分刻みでない、選べない値なら、エラーを返す', () => {
		expect(
			parseDailyDigestForm(
				form({ timing: 'custom', customHour: '07', customMinute: '13', customDay: 'today' }),
				DEFAULT_DAILY_DIGEST_SETTINGS,
			),
		).toEqual({ ok: false, error: '時刻は 5 分刻みで選んでください。' });
		expect(
			parseDailyDigestForm(
				form({ timing: 'custom', customDay: 'today' }),
				DEFAULT_DAILY_DIGEST_SETTINGS,
			).ok,
		).toBe(false);
		expect(parseDailyDigestForm(form({ timing: 'noon' }), DEFAULT_DAILY_DIGEST_SETTINGS).ok).toBe(
			false,
		);
		expect(
			parseDailyDigestForm(
				form({ timing: 'custom', customHour: '07', customMinute: '15', customDay: 'yesterday' }),
				DEFAULT_DAILY_DIGEST_SETTINGS,
			).ok,
		).toBe(false);
	});
});
