import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startMockOidcServer } from './mock-oidc-server.ts';

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function publishedKeys(keyFile?: string): Promise<unknown> {
	const server = await startMockOidcServer({
		clientId: 'client',
		clientSecret: 'secret',
		...(keyFile && { keyFile }),
	});
	try {
		return await (await fetch(`${server.issuer}/jwks`)).json();
	} finally {
		await server.close();
	}
}

describe('startMockOidcServer', () => {
	it('keyFile を渡すと、立て直しても同じ署名の鍵を使う (アプリが覚えた公開鍵で検証できるように)', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'funmary-mock-oidc-'));
		dirs.push(dir);
		const keyFile = join(dir, 'key.pem');
		expect(await publishedKeys(keyFile)).toEqual(await publishedKeys(keyFile));
	});

	it('keyFile を渡さなければ、立てるたびに鍵を作る', async () => {
		expect(await publishedKeys()).not.toEqual(await publishedKeys());
	});
});
