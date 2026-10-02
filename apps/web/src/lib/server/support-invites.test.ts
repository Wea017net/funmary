import { describe, expect, it } from 'vitest';
import {
	activeInvites,
	inviteUrl,
	parseInviteUrl,
	parseIssueForm,
	parseManualForm,
	publicInvite,
	readInvites,
	type SupportInvite,
} from './support-invites.ts';

const NOW = new Date('2026-10-02T00:00:00Z');

const invite = (overrides: Partial<SupportInvite> = {}): SupportInvite => ({
	id: 'i1',
	code: 'abcDEF',
	source: 'bot',
	public: true,
	channelId: '5',
	roles: [],
	note: null,
	maxUses: 0,
	createdAt: '2026-10-01T00:00:00.000Z',
	expiresAt: null,
	revokedAt: null,
	...overrides,
});

const form = (entries: Record<string, string | string[]>) => {
	const data = new FormData();
	for (const [key, value] of Object.entries(entries)) {
		for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
	}
	return data;
};

describe('招待の URL', () => {
	it('discord.gg と discord.com/invite の URL から、コードを取り出す', () => {
		expect(parseInviteUrl('https://discord.gg/abcDEF')).toBe('abcDEF');
		expect(parseInviteUrl(' https://discord.com/invite/abc-123 ')).toBe('abc-123');
		expect(parseInviteUrl('https://discordapp.com/invite/abc')).toBe('abc');
		expect(inviteUrl('abcDEF')).toBe('https://discord.gg/abcDEF');
	});

	it('Discord の招待でない URL、http、余計な部分のある URL は受け付けない', () => {
		expect(parseInviteUrl('https://example.com/abc')).toBeNull();
		expect(parseInviteUrl('http://discord.gg/abc')).toBeNull();
		expect(parseInviteUrl('https://discord.gg/abc/def')).toBeNull();
		expect(parseInviteUrl('https://discord.gg/<script>')).toBeNull();
		expect(parseInviteUrl('discord.gg/abc')).toBeNull();
	});
});

describe('保存した招待の読み取り', () => {
	it('形の合うものだけを読む。壊れた値は空にする', () => {
		expect(readInvites([invite(), { code: 1 }])).toEqual([invite()]);
		expect(readInvites('壊れた値')).toEqual([]);
		expect(readInvites(null)).toEqual([]);
	});
});

describe('使える招待と、公開する招待', () => {
	it('取り消したものと、期限の切れたものは使えない', () => {
		const list = [
			invite({ id: 'a' }),
			invite({ id: 'b', revokedAt: '2026-10-01T12:00:00.000Z' }),
			invite({ id: 'c', expiresAt: '2026-10-01T23:59:59.000Z' }),
			invite({ id: 'd', expiresAt: '2026-10-03T00:00:00.000Z' }),
		];
		expect(activeInvites(list, NOW).map((item) => item.id)).toEqual(['a', 'd']);
	});

	it('公開する招待は、使えるもののうち公開にした、いちばん新しいもの', () => {
		const list = [
			invite({ id: 'old', createdAt: '2026-09-01T00:00:00.000Z' }),
			invite({ id: 'new', code: 'newer', createdAt: '2026-10-01T00:00:00.000Z' }),
			invite({ id: 'private', public: false, createdAt: '2026-10-01T12:00:00.000Z' }),
		];
		expect(publicInvite(list, NOW)).toEqual({ url: 'https://discord.gg/newer' });
		expect(publicInvite([invite({ public: false })], NOW)).toBeNull();
	});
});

describe('Bot での発行の入力', () => {
	const options = {
		channels: [{ id: '5', name: 'welcome' }],
		roles: [
			{ id: '7', name: 'student' },
			{ id: '8', name: 'tester' },
		],
	};

	it('期限 (日)、回数、ロール、公開、メモを読む。期限 0 は無期限', () => {
		expect(
			parseIssueForm(
				form({
					channelId: '5',
					days: '0',
					maxUses: '0',
					roleIds: ['7', '8'],
					public: 'on',
					note: ' 新入生向け ',
				}),
				options,
			),
		).toEqual({
			ok: true,
			value: {
				channelId: '5',
				maxAgeSeconds: 0,
				maxUses: 0,
				roles: [
					{ id: '7', name: 'student' },
					{ id: '8', name: 'tester' },
				],
				public: true,
				note: '新入生向け',
			},
		});
	});

	it('期限は 7 日まで、回数は 100 回まで。知らないチャンネルとロールは受け付けない', () => {
		const base = { channelId: '5', days: '1', maxUses: '1' };
		expect(parseIssueForm(form({ ...base, days: '8' }), options).ok).toBe(false);
		expect(parseIssueForm(form({ ...base, maxUses: '101' }), options).ok).toBe(false);
		expect(parseIssueForm(form({ ...base, channelId: '6' }), options).ok).toBe(false);
		expect(parseIssueForm(form({ ...base, roleIds: '9' }), options).ok).toBe(false);
		expect(parseIssueForm(form(base), options)).toMatchObject({
			ok: true,
			value: { maxAgeSeconds: 86400, public: false, note: null, roles: [] },
		});
	});
});

describe('自分で作った招待の登録の入力', () => {
	it('URL からコードを取り出し、公開とメモを読む', () => {
		expect(parseManualForm(form({ url: 'https://discord.gg/abc', note: '' }))).toEqual({
			ok: true,
			value: { code: 'abc', public: false, note: null },
		});
		expect(parseManualForm(form({ url: 'https://example.com/abc' })).ok).toBe(false);
	});
});
