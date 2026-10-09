// PNG の画像 1 枚を、ICO の形式に包む。ICO は PNG をそのまま中に入れられるので、画像の変換はしない。
// /favicon.ico を探すクライアント (ファビコンの取得、古いブラウザ) 向け。

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ICONDIR_BYTES = 6;
const ICONDIRENTRY_BYTES = 16;
const MAX_ICO_SIZE = 256;

/** PNG でない、または ICO に入らない大きさ (256 px 超) なら null */
export function pngToIco(png: Uint8Array): Uint8Array<ArrayBuffer> | null {
	if (png.length < 24 || !PNG_SIGNATURE.every((byte, i) => png[i] === byte)) return null;
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	// IHDR の幅と高さ (署名 8 + 長さ 4 + 種別 4 のあと)
	const width = view.getUint32(16);
	const height = view.getUint32(20);
	if (width === 0 || height === 0 || width > MAX_ICO_SIZE || height > MAX_ICO_SIZE) return null;

	const ico = new Uint8Array(ICONDIR_BYTES + ICONDIRENTRY_BYTES + png.length);
	const out = new DataView(ico.buffer);
	out.setUint16(2, 1, true); // 種別: アイコン
	out.setUint16(4, 1, true); // 画像の数
	// 256 は 0 で表す
	out.setUint8(ICONDIR_BYTES, width === MAX_ICO_SIZE ? 0 : width);
	out.setUint8(ICONDIR_BYTES + 1, height === MAX_ICO_SIZE ? 0 : height);
	out.setUint16(ICONDIR_BYTES + 4, 1, true); // 色の面
	out.setUint16(ICONDIR_BYTES + 6, 32, true); // 1 画素あたりのビット数
	out.setUint32(ICONDIR_BYTES + 8, png.length, true);
	out.setUint32(ICONDIR_BYTES + 12, ICONDIR_BYTES + ICONDIRENTRY_BYTES, true);
	ico.set(png, ICONDIR_BYTES + ICONDIRENTRY_BYTES);
	return ico;
}
