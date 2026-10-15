// 端末の色。NO_COLOR (https://no-color.org) に従い、色を出さない指定と、端末でない出力 (パイプなど) では、素の文字にする。

export interface Style {
	bold: (text: string) => string;
	dim: (text: string) => string;
	red: (text: string) => string;
	green: (text: string) => string;
}

const wrap = (open: number, close: number) => (text: string) =>
	`\u001b[${open}m${text}\u001b[${close}m`;

const colored: Style = {
	bold: wrap(1, 22),
	dim: wrap(2, 22),
	red: wrap(31, 39),
	green: wrap(32, 39),
};
const plain: Style = { bold: (t) => t, dim: (t) => t, red: (t) => t, green: (t) => t };

/** 色を出すか。NO_COLOR が (空でなく) あれば出さない。端末でなければ出さない */
export function createStyle(options: {
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly isTTY: boolean;
}): Style {
	const noColor = options.env['NO_COLOR'];
	return noColor !== undefined && noColor !== '' ? plain : options.isTTY ? colored : plain;
}
