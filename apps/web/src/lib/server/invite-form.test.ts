import { describe, expect, it } from 'vitest';
import { parseInviteForm, parseInviteSettingsForm } from './invite-form.ts';

const form = (entries: Record<string, string>) => {
	const data = new FormData();
	for (const [key, value] of Object.entries(entries)) data.set(key, value);
	return data;
};

describe('parseInviteForm', () => {
	it('使用回数、期限の日数、メモを読む。期限が空なら期限なし、メモが空なら null', () => {
		expect(parseInviteForm(form({ uses: '3', days: '7', note: ' 研究室 ' }))).toEqual({
			ok: true,
			value: { maxUses: 3, days: 7, note: '研究室' },
		});
		expect(parseInviteForm(form({ uses: '1', days: '', note: '' }))).toEqual({
			ok: true,
			value: { maxUses: 1, days: null, note: null },
		});
	});

	it('管理者でない人のフォームには回数と期限がないので、既定の値で読む (使うときに固定の値にする)', () => {
		expect(parseInviteForm(form({ note: '友人' }))).toEqual({
			ok: true,
			value: { maxUses: 1, days: 30, note: '友人' },
		});
	});

	it('範囲の外の値と、長すぎるメモは断る', () => {
		expect(parseInviteForm(form({ uses: '0', days: '7' }))).toMatchObject({ ok: false });
		expect(parseInviteForm(form({ uses: '101', days: '7' }))).toMatchObject({ ok: false });
		expect(parseInviteForm(form({ uses: '1', days: '366' }))).toMatchObject({ ok: false });
		expect(parseInviteForm(form({ uses: '1.5', days: '7' }))).toMatchObject({ ok: false });
		expect(parseInviteForm(form({ note: 'あ'.repeat(101) }))).toMatchObject({ ok: false });
	});
});

describe('parseInviteSettingsForm', () => {
	it('モードと月の上限を読み、知らないモードは断る', () => {
		expect(parseInviteSettingsForm(form({ issuers: 'permitted', monthlyLimit: '3' }))).toEqual({
			ok: true,
			value: { issuers: 'permitted', monthlyLimit: 3 },
		});
		expect(parseInviteSettingsForm(form({ issuers: 'everyone', monthlyLimit: '3' }))).toMatchObject(
			{ ok: false },
		);
		expect(parseInviteSettingsForm(form({ issuers: 'anyone', monthlyLimit: '-1' }))).toMatchObject({
			ok: false,
		});
	});
});
