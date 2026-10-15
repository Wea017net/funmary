import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	FLAG_EPHEMERAL,
	ephemeralMessage,
	invocationOf,
	pongResponse,
	verifyDiscordRequest,
} from './interactions-protocol.ts';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicKeyHex = publicKey
	.export({ format: 'der', type: 'spki' })
	.subarray(-32)
	.toString('hex');
const NOW = new Date('2026-10-04T00:00:00Z');
const timestamp = String(Math.floor(NOW.getTime() / 1000));
const body = '{"type":1}';

const signed = (message: string) =>
	sign(null, Buffer.from(message, 'utf8'), privateKey).toString('hex');

describe('verifyDiscordRequest', () => {
	it('Discord の鍵で署名された本文を通す', () => {
		expect(
			verifyDiscordRequest({
				publicKeyHex,
				signatureHex: signed(timestamp + body),
				timestamp,
				body,
				now: NOW,
			}),
		).toBe(true);
	});

	it('本文が改ざんされていれば通さない', () => {
		expect(
			verifyDiscordRequest({
				publicKeyHex,
				signatureHex: signed(timestamp + body),
				timestamp,
				body: '{"type":2}',
				now: NOW,
			}),
		).toBe(false);
	});

	it('古いタイムスタンプ (再送) は通さない', () => {
		const old = String(Math.floor(NOW.getTime() / 1000) - 10 * 60);
		expect(
			verifyDiscordRequest({
				publicKeyHex,
				signatureHex: signed(old + body),
				timestamp: old,
				body,
				now: NOW,
			}),
		).toBe(false);
	});

	it('署名や時刻がない、形が違う場合は通さない', () => {
		const base = { publicKeyHex, body, now: NOW };
		expect(verifyDiscordRequest({ ...base, signatureHex: undefined, timestamp })).toBe(false);
		expect(verifyDiscordRequest({ ...base, signatureHex: 'abc', timestamp })).toBe(false);
		expect(verifyDiscordRequest({ ...base, signatureHex: signed(body), timestamp: 'x' })).toBe(
			false,
		);
	});
});

describe('応答', () => {
	it('PING には PONG を返す', () => {
		expect(pongResponse()).toEqual({ type: 1 });
	});

	it('個人の出力は、必ず ephemeral (本人にだけ見える) にする', () => {
		const response = ephemeralMessage('今日の授業');
		expect(response.data.flags).toBe(FLAG_EPHEMERAL);
		expect(response.type).toBe(4);
	});
});

describe('invocationOf', () => {
	it('サーバーの中では member、DM ではユーザーから、呼んだ人を取り出す', () => {
		expect(invocationOf({ data: { name: 'today' }, member: { user: { id: '1' } } })).toEqual({
			command: 'today',
			userId: '1',
		});
		expect(invocationOf({ data: { name: 'week' }, user: { id: '2' } })).toEqual({
			command: 'week',
			userId: '2',
		});
	});

	it('形が違えば null', () => {
		expect(invocationOf({ data: { name: 'today' } })).toBeNull();
		expect(invocationOf(null)).toBeNull();
	});
});
