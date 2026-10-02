import { createServer, type Server } from 'node:http';
import { BlockList } from 'node:net';
import { Agent, fetch } from 'undici';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	checkWebhookUrl,
	createSsrfSafeAgent,
	fixedLookup,
	guardedLookup,
	isBlockedAddress,
	SsrfBlockedError,
} from './ssrf-guard.ts';

describe('checkWebhookUrl', () => {
	it('https で、ポートが省略か 443 か 8443 のものだけを許す', () => {
		expect(checkWebhookUrl('https://example.com/hook')).toEqual({ ok: true });
		expect(checkWebhookUrl('https://example.com:8443/hook')).toEqual({ ok: true });
		expect(checkWebhookUrl('https://example.com:443/hook')).toEqual({ ok: true });
	});

	it('http、ほかのポート、壊れた URL を断る', () => {
		expect(checkWebhookUrl('http://example.com/hook')).toMatchObject({ ok: false });
		expect(checkWebhookUrl('https://example.com:8080/hook')).toMatchObject({ ok: false });
		expect(checkWebhookUrl('not a url')).toMatchObject({ ok: false });
		expect(checkWebhookUrl('')).toMatchObject({ ok: false });
	});
});

describe('isBlockedAddress', () => {
	const blocked = (() => {
		const list = new BlockList();
		list.addSubnet('127.0.0.0', 8, 'ipv4');
		list.addSubnet('10.0.0.0', 8, 'ipv4');
		list.addSubnet('169.254.0.0', 16, 'ipv4');
		list.addAddress('::1', 'ipv6');
		list.addSubnet('fc00::', 7, 'ipv6');
		return list;
	})();

	it('ループバック、プライベート、リンクローカルの IPv4 を内側と見なす', () => {
		expect(isBlockedAddress(blocked, '127.0.0.1', 4)).toBe(true);
		expect(isBlockedAddress(blocked, '10.1.2.3', 4)).toBe(true);
		expect(isBlockedAddress(blocked, '169.254.1.1', 4)).toBe(true);
		expect(isBlockedAddress(blocked, '8.8.8.8', 4)).toBe(false);
	});

	it('ループバックとユニークローカルの IPv6 を内側と見なす', () => {
		expect(isBlockedAddress(blocked, '::1', 6)).toBe(true);
		expect(isBlockedAddress(blocked, 'fd00::1', 6)).toBe(true);
		expect(isBlockedAddress(blocked, '2001:4860:4860::8888', 6)).toBe(false);
	});

	it('IPv4 射影の IPv6 アドレスは、埋め込まれた IPv4 のほうも調べる (::ffff:10.0.0.1 など)', () => {
		expect(isBlockedAddress(blocked, '::ffff:10.0.0.1', 6)).toBe(true);
		expect(isBlockedAddress(blocked, '::ffff:8.8.8.8', 6)).toBe(false);
	});
});

describe('guardedLookup', () => {
	it('引いた IP が内側なら、SsrfBlockedError を渡す', () => {
		const list = new BlockList();
		list.addSubnet('127.0.0.0', 8, 'ipv4');
		const lookup = guardedLookup(fixedLookup('127.0.0.1'), list);
		lookup('internal.example.com', {}, (error, address, family) => {
			expect(error).toBeInstanceOf(SsrfBlockedError);
			expect(address).toBe('127.0.0.1');
			expect(family).toBe(4);
		});
	});

	it('内側でなければ、そのまま通す', () => {
		const list = new BlockList();
		list.addSubnet('127.0.0.0', 8, 'ipv4');
		const lookup = guardedLookup(fixedLookup('203.0.113.1'), list);
		lookup('example.com', {}, (error, address) => {
			expect(error).toBeNull();
			expect(address).toBe('203.0.113.1');
		});
	});

	it('名前解決が失敗したら、そのままエラーを渡す', () => {
		const list = new BlockList();
		const notFound = new Error('not found');
		const lookup = guardedLookup(
			(_hostname, _options, callback) => callback(notFound, '', 4),
			list,
		);
		lookup('nowhere.invalid', {}, (error) => {
			expect(error).toBe(notFound);
		});
	});

	// undici は options.all: true (複数の候補を配列で返す形) で引く
	it('options.all が true のとき、複数の候補から内側のものだけを取り除く', () => {
		const list = new BlockList();
		list.addSubnet('127.0.0.0', 8, 'ipv4');
		const lookup = guardedLookup(
			(_hostname, _options, callback) =>
				callback(
					null,
					[
						{ address: '127.0.0.1', family: 4 },
						{ address: '203.0.113.1', family: 4 },
					],
					4,
				),
			list,
		);
		lookup('mixed.example.com', { all: true }, (error, addresses) => {
			expect(error).toBeNull();
			expect(addresses).toEqual([{ address: '203.0.113.1', family: 4 }]);
		});
	});

	it('すべての候補が内側なら、SsrfBlockedError を渡す', () => {
		const list = new BlockList();
		list.addSubnet('127.0.0.0', 8, 'ipv4');
		const lookup = guardedLookup(
			(_hostname, _options, callback) => callback(null, [{ address: '127.0.0.1', family: 4 }], 4),
			list,
		);
		lookup('internal.example.com', { all: true }, (error) => {
			expect(error).toBeInstanceOf(SsrfBlockedError);
		});
	});
});

describe('createSsrfSafeAgent (undici の Agent との結合)', () => {
	let server: Server;
	let port: number;
	let dispatcher: Agent | undefined;

	beforeAll(async () => {
		server = createServer((_req, res) => res.end('ok'));
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		port = (server.address() as { port: number }).port;
	});

	afterAll(async () => {
		await new Promise((resolve) => server.close(resolve));
	});

	afterEach(async () => {
		await dispatcher?.close();
		dispatcher = undefined;
	});

	it('名前を引いた先がループバックなら、接続せずに失敗する (手元のサーバーへの SSRF を防ぐ)', async () => {
		dispatcher = createSsrfSafeAgent({ lookup: fixedLookup('127.0.0.1') });
		await expect(
			fetch(`http://internal.example.invalid:${port}/`, { dispatcher }),
		).rejects.toThrow();
	});

	it('guardedLookup は、引いた先が内側でなければ fetch をそのまま通す', async () => {
		// createSsrfSafeAgent の一覧はループバックを常に塞ぐので、ここでは空の一覧で結合だけを確かめる
		dispatcher = new Agent({
			connect: { lookup: guardedLookup(fixedLookup('127.0.0.1'), new BlockList()) },
		});
		await expect(fetch(`http://example.invalid:${port}/`, { dispatcher })).resolves.toMatchObject({
			ok: true,
		});
	});
});
