// PDF から、文字とその座標を取り出す。pdfjs-dist (Mozilla) を使う。文字のデータが入った PDF が対象で、画像の PDF は読めない。
// 取り出した文字の配列は grid.ts に渡す。管理者が手元で 1 回動かす取り込みで使う (定期処理では使わない)。
import { readTextItems, withPdfDocument } from '../pdf/document.ts';
import {
	parseTimetableItems,
	type PdfTextItem,
	type TimetablePdfOptions,
	type TimetablePdfResult,
} from './grid.ts';

/** PDF の大きさの上限 (実物は 100 KB 前後) */
const MAX_PDF_BYTES = 10 * 1024 * 1024;
/** 1 ページの表として読む。ページが多いものは、別の種類の PDF とみなす */
const MAX_PAGES = 3;

export type ExtractResult =
	| { readonly kind: 'ok'; readonly items: readonly PdfTextItem[] }
	| { readonly kind: 'invalid'; readonly reason: string };

export async function extractPdfTextItems(data: Uint8Array): Promise<ExtractResult> {
	if (data.byteLength === 0) return { kind: 'invalid', reason: 'PDF が空です' };
	if (data.byteLength > MAX_PDF_BYTES) return { kind: 'invalid', reason: 'PDF が大きすぎます' };
	try {
		return await withPdfDocument(data, async (doc): Promise<ExtractResult> => {
			if (doc.numPages < 1 || doc.numPages > MAX_PAGES) {
				return { kind: 'invalid', reason: `ページ数が想定と違います (${doc.numPages} ページ)` };
			}
			return { kind: 'ok', items: await readTextItems(await doc.getPage(1)) };
		});
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return { kind: 'invalid', reason: `PDF を読めませんでした: ${reason}` };
	}
}

/** PDF のファイルの内容から、授業時間割を読む */
export async function parseTimetablePdf(
	data: Uint8Array,
	options?: Partial<TimetablePdfOptions>,
): Promise<TimetablePdfResult> {
	const extracted = await extractPdfTextItems(data);
	if (extracted.kind === 'invalid') return extracted;
	return parseTimetableItems(extracted.items, options);
}
