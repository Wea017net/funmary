import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeDataUrl, loadBrandAsset } from './brand-assets.ts';

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const defaults = {
	'icon.svg': new TextEncoder().encode('<svg>default</svg>'),
	'icon-192.png': new Uint8Array([1, 2, 3]),
};

describe('loadBrandAsset', () => {
	it('BRAND_DIR がなければ、同梱の画像を返す', async () => {
		expect(await loadBrandAsset('icon.svg', { brandDir: null, defaults })).toEqual({
			body: defaults['icon.svg'],
			type: 'image/svg+xml',
		});
		expect(await loadBrandAsset('icon-192.png', { brandDir: null, defaults })).toMatchObject({
			type: 'image/png',
		});
	});

	it('BRAND_DIR に同じ名前のファイルがあれば、それを優先し、なければ同梱の画像を返す', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'funmary-brand-'));
		dirs.push(dir);
		writeFileSync(join(dir, 'icon.svg'), '<svg>mine</svg>');
		const own = await loadBrandAsset('icon.svg', { brandDir: dir, defaults });
		expect(new TextDecoder().decode(own?.body)).toBe('<svg>mine</svg>');
		expect(await loadBrandAsset('icon-192.png', { brandDir: dir, defaults })).toMatchObject({
			body: defaults['icon-192.png'],
		});
	});

	it('決まった名前でなければ、BRAND_DIR のほかのファイル (../ を含むものなど) を読まない', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'funmary-brand-'));
		dirs.push(dir);
		writeFileSync(join(dir, 'secret.txt'), 'secret');
		for (const name of ['secret.txt', '../secret.txt', 'icon.svg/../secret.txt']) {
			expect(await loadBrandAsset(name, { brandDir: dir, defaults })).toBeNull();
		}
	});
});

describe('decodeDataUrl', () => {
	it('Base64 と、URL エンコードの data URL を、バイト列に戻す', () => {
		expect(Array.from(decodeDataUrl('data:image/png;base64,AQID'))).toEqual([1, 2, 3]);
		expect(new TextDecoder().decode(decodeDataUrl('data:image/svg+xml,%3Csvg%3E'))).toBe('<svg>');
	});
});
