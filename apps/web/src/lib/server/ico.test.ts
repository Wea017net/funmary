import { describe, expect, it } from 'vitest';
import { pngToIco } from './ico.ts';

function fakePng(width: number, height: number): Uint8Array {
	const png = new Uint8Array(40);
	png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	const view = new DataView(png.buffer);
	view.setUint32(16, width);
	view.setUint32(20, height);
	return png;
}

describe('pngToIco', () => {
	it('PNG を、画像 1 枚の ICO に包む', () => {
		const png = fakePng(192, 192);

		const ico = pngToIco(png);

		expect(ico).not.toBeNull();
		const view = new DataView(ico!.buffer);
		expect(view.getUint16(2, true)).toBe(1);
		expect(view.getUint16(4, true)).toBe(1);
		expect(ico![6]).toBe(192);
		expect(ico![7]).toBe(192);
		expect(view.getUint32(14, true)).toBe(png.length);
		expect(view.getUint32(18, true)).toBe(22);
		expect(Array.from(ico!.slice(22))).toEqual(Array.from(png));
	});

	it('256 px は 0 で表す', () => {
		const ico = pngToIco(fakePng(256, 256));

		expect(ico![6]).toBe(0);
		expect(ico![7]).toBe(0);
	});

	it('PNG でないものと、256 px を超える画像は包まない', () => {
		expect(pngToIco(new Uint8Array(40))).toBeNull();
		expect(pngToIco(fakePng(512, 512))).toBeNull();
	});
});
