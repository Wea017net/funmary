// 大学の公式サイトの「教育に関する情報」のページから、学年暦の PDF を探して取る。
// 外部への通信は、定期処理からだけ呼ぶ。fetch は差し替えられる (テストと、通信の制御のため)。
// リンクは表示の文字 (例: "2026学年暦") で探し、大学サイトの https の PDF だけを使う。
import { fromHtml } from 'hast-util-from-html';
import { selectAll } from 'hast-util-select';
import { toText } from 'hast-util-to-text';
import { readHtml } from '../portal/http.ts';

export const ACADEMIC_INFO_URL = 'https://www.fun.ac.jp/about/univ-academic/';
const SITE_HOST = 'www.fun.ac.jp';

/** 外部の応答が遅いときに待つ時間 */
const TIMEOUT_MS = 30_000;
/** 学年暦の PDF の大きさの上限。今の PDF は 230 KB ほど */
const MAX_PDF_BYTES = 10 * 1024 * 1024;

export interface AcademicCalendarLink {
	readonly year: number;
	readonly url: string;
}

/** ページの中の「(年)学年暦」のリンク。大学サイトの https の PDF だけを、新しい年から並べる */
export function findAcademicCalendarLinks(html: string): AcademicCalendarLink[] {
	const byYear = new Map<number, string>();
	for (const anchor of selectAll('a[href]', fromHtml(html))) {
		const year = /(\d{4})\s*学年暦/.exec(toText(anchor))?.[1];
		const href = anchor.properties['href'];
		if (!year || typeof href !== 'string') continue;
		let url: URL;
		try {
			url = new URL(href, ACADEMIC_INFO_URL);
		} catch {
			continue;
		}
		if (url.protocol !== 'https:' || url.hostname !== SITE_HOST) continue;
		if (!url.pathname.toLowerCase().endsWith('.pdf')) continue;
		if (!byYear.has(Number(year))) byYear.set(Number(year), url.href);
	}
	return [...byYear].sort(([a], [b]) => b - a).map(([year, url]) => ({ year, url }));
}

export interface FetchAcademicCalendarDeps {
	readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

export type FetchAcademicCalendarResult =
	| { readonly kind: 'ok'; readonly year: number; readonly url: string; readonly bytes: Uint8Array }
	| { readonly kind: 'failed'; readonly message: string };

/** 例外は投げず、結果として返す。1 つの取得元の失敗を、ほかの処理に波及させないため */
export async function fetchAcademicCalendarPdf(
	deps: FetchAcademicCalendarDeps,
): Promise<FetchAcademicCalendarResult> {
	try {
		// ほかのホストへ転送されたら、たどらずに失敗にする
		const init = { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) } as const;
		const page = await deps.fetch(ACADEMIC_INFO_URL, init);
		if (!page.ok) {
			return {
				kind: 'failed',
				message: `教育に関する情報のページが HTTP ${page.status} を返しました`,
			};
		}
		const [latest] = findAcademicCalendarLinks(await readHtml(page));
		if (!latest) {
			return {
				kind: 'failed',
				message: '教育に関する情報のページに、学年暦の PDF のリンクが見つかりません',
			};
		}
		const response = await deps.fetch(latest.url, init);
		if (!response.ok) {
			return { kind: 'failed', message: `学年暦の PDF が HTTP ${response.status} を返しました` };
		}
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > MAX_PDF_BYTES) {
			return { kind: 'failed', message: '学年暦の PDF が大きすぎるので、読みませんでした' };
		}
		if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
			return { kind: 'failed', message: '学年暦のリンクの先が PDF ではありません' };
		}
		return { kind: 'ok', year: latest.year, url: latest.url, bytes };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return { kind: 'failed', message: `学年暦の PDF を取得できませんでした: ${reason}` };
	}
}
