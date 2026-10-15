// 端末での文字の幅。日本語の全角の文字は、半角の 2 つ分の幅を取る。表の桁をそろえるのに使う。

/** 全角 (幅 2) の範囲。CJK の漢字、かな、全角記号、ハングルなど */
const WIDE: readonly (readonly [number, number])[] = [
	[0x1100, 0x115f],
	[0x2e80, 0x303e],
	[0x3041, 0x33ff],
	[0x3400, 0x4dbf],
	[0x4e00, 0x9fff],
	[0xa000, 0xa4cf],
	[0xac00, 0xd7a3],
	[0xf900, 0xfaff],
	[0xfe30, 0xfe6f],
	[0xff00, 0xff60],
	[0xffe0, 0xffe6],
	[0x20000, 0x3fffd],
];

function widthOf(codePoint: number): number {
	// 結合文字と、幅のない制御文字
	if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
	if (codePoint >= 0x300 && codePoint <= 0x36f) return 0;
	return WIDE.some(([from, to]) => codePoint >= from && codePoint <= to) ? 2 : 1;
}

/** 端末で占める幅。ANSI の色の指定は数えない */
export function displayWidth(text: string): number {
	let total = 0;
	for (const char of stripAnsi(text)) total += widthOf(char.codePointAt(0) ?? 0);
	return total;
}

// eslint-disable-next-line no-control-regex -- ANSI のエスケープシーケンスを取り除く
const ANSI = /\u001b\[[0-9;]*m/g;
export const stripAnsi = (text: string) => text.replace(ANSI, '');

/** 幅 width に収まるよう、末尾を「…」で切る。収まるなら、そのまま。色の指定を含む文字列は、切らずに返す */
export function truncate(text: string, width: number): string {
	if (displayWidth(text) <= width) return text;
	if (text !== stripAnsi(text)) return text;
	let result = '';
	let used = 0;
	for (const char of text) {
		const w = widthOf(char.codePointAt(0) ?? 0);
		if (used + w > width - 1) break;
		result += char;
		used += w;
	}
	return `${result}…`;
}

/** 幅 width になるよう、右に空白を足す */
export function padEnd(text: string, width: number): string {
	return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
}
