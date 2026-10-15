// 端末の幅に合わせた、桁をそろえた表。全角の文字は、幅 2 で数える。
import { displayWidth, padEnd, truncate } from './width.ts';

const GAP = '  ';
/** 列を、これより狭くはしない */
const MIN_COLUMN_WIDTH = 6;

/** 表を、行の文字列にする。端末の幅に収まらないときは、いちばん広い列から、「…」で切る。見出しの行は dim で出す */
export function renderTable(
	header: readonly string[],
	rows: readonly (readonly string[])[],
	maxWidth: number,
	dim: (text: string) => string = (text) => text,
): string[] {
	const columns = header.length;
	const widths = header.map((title, column) =>
		Math.max(displayWidth(title), ...rows.map((row) => displayWidth(row[column] ?? ''))),
	);
	const gaps = GAP.length * (columns - 1);
	while (widths.reduce((a, b) => a + b, 0) + gaps > maxWidth) {
		const widest = widths.indexOf(Math.max(...widths));
		if ((widths[widest] ?? 0) <= MIN_COLUMN_WIDTH) break;
		widths[widest] = (widths[widest] ?? 0) - 1;
	}
	const render = (cells: readonly string[]) =>
		cells
			.map((cell, column) => {
				const width = widths[column] ?? 0;
				const fitted = truncate(cell, width);
				return column === columns - 1 ? fitted : padEnd(fitted, width);
			})
			.join(GAP)
			.trimEnd();
	return [dim(render(header)), ...rows.map(render)];
}
