import { describe, expect, it } from 'vitest';
import { createStyle } from './style.ts';

describe('createStyle', () => {
	it('端末なら、色を付ける', () => {
		expect(createStyle({ env: {}, isTTY: true }).red('x')).toBe('\u001b[31mx\u001b[39m');
	});

	it('NO_COLOR があれば、端末でも、素の文字。空の NO_COLOR は、ないものと同じ', () => {
		expect(createStyle({ env: { NO_COLOR: '1' }, isTTY: true }).bold('x')).toBe('x');
		expect(createStyle({ env: { NO_COLOR: '' }, isTTY: true }).bold('x')).toBe(
			'\u001b[1mx\u001b[22m',
		);
	});

	it('端末でない出力 (パイプなど) では、素の文字', () => {
		expect(createStyle({ env: {}, isTTY: false }).green('x')).toBe('x');
	});
});
