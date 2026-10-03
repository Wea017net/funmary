import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createDiscordInteractionRoutes } from './interactions.ts';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicKeyHex = publicKey
	.export({ format: 'der', type: 'spki' })
	.subarray(-32)
	.toString('hex');

function signedRequest(body: string, now = new Date()) {
	const timestamp = String(Math.floor(now.getTime() / 1000));
	const signature = sign(null, Buffer.from(timestamp + body, 'utf8'), privateKey).toString('hex');
	return {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Signature-Ed25519': signature,
			'X-Signature-Timestamp': timestamp,
		},
		body,
	};
}

const app = (answer = vi.fn(() => '今日の授業')) =>
	createDiscordInteractionRoutes({ publicKeyHex, answer });

describe('POST /discord/interactions', () => {
	it('署名のないリクエストは 401 で、中身を答えない', async () => {
		const answer = vi.fn(() => 'x');
		const res = await app(answer).request('/discord/interactions', {
			method: 'POST',
			body: '{"type":1}',
		});
		expect(res.status).toBe(401);
		expect(answer).not.toHaveBeenCalled();
	});

	it('PING には PONG を返す', async () => {
		const res = await app().request('/discord/interactions', signedRequest('{"type":1}'));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ type: 1 });
	});

	it('コマンドの答えは、本人にだけ見える (ephemeral) 形で返す', async () => {
		const answer = vi.fn(() => '今日の授業');
		const body = JSON.stringify({
			type: 2,
			data: { name: 'today' },
			member: { user: { id: 'discord-1' } },
		});
		const res = await app(answer).request('/discord/interactions', signedRequest(body));
		expect(answer).toHaveBeenCalledWith('today', 'discord-1', expect.any(Date));
		expect(await res.json()).toEqual({
			type: 4,
			data: { content: '今日の授業', flags: 64 },
		});
	});

	it('形の違う本文は 400', async () => {
		const res = await app().request('/discord/interactions', signedRequest('not json'));
		expect(res.status).toBe(400);
	});
});
