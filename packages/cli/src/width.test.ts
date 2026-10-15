import { describe, expect, it } from 'vitest';
import { displayWidth, padEnd, stripAnsi, truncate } from './width.ts';

describe('displayWidth', () => {
	it('半角は 1、全角 (漢字、かな、全角記号) は 2 と数える', () => {
		expect(displayWidth('abc')).toBe(3);
		expect(displayWidth('線形代数')).toBe(8);
		expect(displayWidth('ｱ')).toBe(1);
		expect(displayWidth('Ａ')).toBe(2);
		expect(displayWidth('a線')).toBe(3);
	});

	it('色の指定 (ANSI) は、幅に数えない', () => {
		expect(displayWidth('\u001b[1m休講\u001b[0m')).toBe(4);
		expect(stripAnsi('\u001b[31mx\u001b[0m')).toBe('x');
	});
});

describe('truncate と padEnd', () => {
	it('幅に収まれば、そのまま。収まらなければ、「…」までの幅で切る', () => {
		expect(truncate('abc', 5)).toBe('abc');
		expect(truncate('abcdefg', 5)).toBe('abcd…');
		expect(truncate('線形代数演習', 7)).toBe('線形代…');
		expect(displayWidth(truncate('線形代数演習', 7))).toBeLessThanOrEqual(7);
	});

	it('幅になるまで、右に空白を足す。全角は 2 つ分で数える', () => {
		expect(padEnd('a', 3)).toBe('a  ');
		expect(padEnd('線', 4)).toBe('線  ');
		expect(padEnd('abcd', 2)).toBe('abcd');
	});
});
