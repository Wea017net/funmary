// pdfjs-dist (Mozilla) で PDF を開く。管理者が手元で 1 回動かす取り込みと、学年暦の定期処理で使う。
// 型だけの宣言ファイルなので import では読めない。apps/web の svelte-check は src の宣言ファイルを拾わないため、ここで参照する
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./pdf-worker.d.ts" />
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PdfTextItem } from '../timetable-pdf/grid.ts';

export type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

/** ページの文字の断片と、その位置。空白だけの断片は除く */
export async function readTextItems(page: PDFPageProxy): Promise<PdfTextItem[]> {
	const content = await page.getTextContent();
	const items: PdfTextItem[] = [];
	for (const raw of content.items) {
		if (!('str' in raw) || raw.str.trim() === '') continue;
		const transform = raw.transform as number[];
		items.push({
			text: raw.str,
			x: transform[4] ?? 0,
			y: transform[5] ?? 0,
			height: raw.height,
			width: raw.width,
		});
	}
	return items;
}

/** PDF を開いて read に渡し、終わったら閉じる。読めない PDF は、pdfjs の例外をそのまま投げる */
export async function withPdfDocument<T>(
	data: Uint8Array,
	read: (doc: PDFDocumentProxy, pdfjs: Pdfjs) => Promise<T>,
): Promise<T> {
	// 読み込みが重いので、使うときまで読まない
	const [pdfjs, worker] = await Promise.all([
		import('pdfjs-dist/legacy/build/pdf.mjs'),
		import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
	]);
	// pdfjs は worker のファイルを自分の隣から読もうとするので、1 ファイルにまとめた cli.js では見つからない。
	// 読み込んだ worker を渡しておくと、ファイルを探さずに同じスレッドで動かす
	const global = globalThis as { pdfjsWorker?: unknown };
	global.pdfjsWorker ??= worker;
	// pdfjs は渡したバッファを使い回すので、コピーを渡す
	const task = pdfjs.getDocument({
		data: new Uint8Array(data),
		useSystemFonts: true,
		// フォントは、画面に出すためのものなので、組み込まない (文字と図形の取り出しだけに使う)
		disableFontFace: true,
		verbosity: 0,
	});
	try {
		return await read(await task.promise, pdfjs);
	} finally {
		await task.destroy();
	}
}
