import { describe, expect, it } from 'vitest';
import { parseWebhookCreate, parseWebhookId, parseWebhookUpdate } from './webhook-form.ts';

const URL_OK = 'https://discord.com/api/webhooks/123/abc';
const GENERIC_URL_OK = 'https://example.com/hook';

function form(entries: Record<string, string | string[]>) {
	const data = new FormData();
	for (const [key, value] of Object.entries(entries)) {
		for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
	}
	return data;
}

describe('Webhook の登録のフォーム', () => {
	it('種類、URL、名前、種類を読む。URL の前後の空白は取る。種類は決まった順にそろえる', () => {
		expect(
			parseWebhookCreate(
				form({
					kind: 'discord',
					url: ` ${URL_OK} `,
					label: ' 共有 ',
					kinds: ['roomChange', 'cancellation'],
				}),
			),
		).toEqual({
			ok: true,
			kind: 'discord',
			url: URL_OK,
			label: '共有',
			kinds: ['cancellation', 'roomChange'],
		});
		expect(
			parseWebhookCreate(form({ kind: 'discord', url: URL_OK, kinds: 'makeup' })),
		).toMatchObject({ ok: true, label: null });
	});

	it('種類が discord なら、Discord の Webhook でない URL を断る', () => {
		for (const url of ['', 'https://example.com/hook', 'http://discord.com/api/webhooks/1/a']) {
			expect(parseWebhookCreate(form({ kind: 'discord', url, kinds: 'makeup' }))).toMatchObject({
				ok: false,
			});
		}
	});

	it('種類が generic なら、https のどんな URL でも受け付ける。http や、おかしなポートは断る', () => {
		expect(
			parseWebhookCreate(form({ kind: 'generic', url: GENERIC_URL_OK, kinds: 'makeup' })),
		).toMatchObject({ ok: true, kind: 'generic', url: GENERIC_URL_OK });
		for (const url of ['http://example.com/hook', 'https://example.com:8080/hook']) {
			expect(parseWebhookCreate(form({ kind: 'generic', url, kinds: 'makeup' }))).toMatchObject({
				ok: false,
			});
		}
	});

	it('種類が選ばれていなければ断る', () => {
		expect(parseWebhookCreate(form({ url: URL_OK, kinds: 'makeup' }))).toMatchObject({
			ok: false,
		});
		expect(
			parseWebhookCreate(form({ kind: 'something-else', url: URL_OK, kinds: 'makeup' })),
		).toMatchObject({ ok: false });
	});

	it('種類が選ばれていない、知らない種類だけ、名前が長すぎるのを断る', () => {
		expect(parseWebhookCreate(form({ kind: 'discord', url: URL_OK }))).toMatchObject({
			ok: false,
		});
		expect(
			parseWebhookCreate(form({ kind: 'discord', url: URL_OK, kinds: 'notice' })),
		).toMatchObject({ ok: false });
		expect(
			parseWebhookCreate(
				form({ kind: 'discord', url: URL_OK, kinds: 'makeup', label: 'あ'.repeat(41) }),
			),
		).toMatchObject({ ok: false });
	});
});

describe('Webhook の更新のフォーム', () => {
	it('名前と種類を読む', () => {
		expect(parseWebhookUpdate(form({ label: '', kinds: 'integration' }))).toEqual({
			ok: true,
			label: null,
			kinds: ['integration'],
		});
		expect(parseWebhookUpdate(form({ label: 'x' }))).toMatchObject({ ok: false });
	});
});

describe('Webhook の ID', () => {
	it('数字だけを受け付ける', () => {
		expect(parseWebhookId(form({ id: '12' }))).toBe(12);
		for (const id of ['', 'a', '-1', '1.5']) expect(parseWebhookId(form({ id }))).toBeNull();
		expect(parseWebhookId(form({}))).toBeNull();
	});
});
