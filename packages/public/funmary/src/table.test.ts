import { describe, expect, it } from 'vitest';
import { renderTable } from './table.ts';
import { displayWidth } from './width.ts';

describe('renderTable', () => {
	it('列の幅をそろえ、最後の列の右には空白を残さない', () => {
		expect(
			renderTable(
				['時限', '科目'],
				[
					['1', '線形代数'],
					['2', '英語'],
				],
				80,
			),
		).toEqual(['時限  科目', '1     線形代数', '2     英語']);
	});

	it('端末の幅に収まらないときは、いちばん広い列を、「…」で切る', () => {
		const lines = renderTable(
			['時限', '科目', '教室'],
			[['1', '情報アーキテクチャ演習とても長い名前', '363']],
			30,
		);
		for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(30);
		expect(lines[1]).toContain('…');
		expect(lines[1]).toContain('363');
	});

	it('見出しの行に、色の関数を使う', () => {
		const lines = renderTable(['a'], [['b']], 20, (text) => `<${text}>`);
		expect(lines).toEqual(['<a>', 'b']);
	});

	it('これ以上は狭くしない', () => {
		const lines = renderTable(['a', 'b'], [['abcdefghij', 'klmnopqrst']], 4);
		expect(lines.length).toBe(2);
	});
});
