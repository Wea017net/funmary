import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import {
	buildBookmarklet,
	collectTimetableCells,
	IMPORT_PATH,
	type DomDocument,
} from './bookmarklet.ts';
import { decodeImportFragment } from './payload.ts';

const html = readFileSync(new URL('./fixtures/timetable-page.html', import.meta.url), 'utf8');
/** linkedom の型は、DOM の型がないと解決できないので、使う部分の型 (DomDocument) にしてから使う */
const pageDocument = () => (parseHTML(html) as unknown as { document: DomDocument }).document;

/**
 * ブックマークレットの中身を、ブラウザと同じ形で (グローバルの document、location などを渡して) 動かす。
 * ブックマークレットは文字列のコードなので、動かして確かめるには、文字列から関数を作るしかない
 */
function runBookmarklet(
	source: string,
	globals: { document: unknown; location: unknown; alert: (message: string) => void },
): void {
	// eslint-disable-next-line @typescript-eslint/no-implied-eval -- 文字列のコード (ブックマークレット) を動かすテストのため
	const run = new Function('document', 'location', 'alert', 'TextEncoder', 'btoa', source) as (
		...args: unknown[]
	) => void;
	run(globals.document, globals.location, globals.alert, TextEncoder, (s: string) =>
		Buffer.from(s, 'binary').toString('base64'),
	);
}

describe('collectTimetableCells (ポータルのページで動く読み取り)', () => {
	it('表の位置から曜日と時限を決め、コマの属性を読む', () => {
		const cells = collectTimetableCells(pageDocument());
		expect(cells).toContainEqual(
			expect.objectContaining({ l: '100001', w: 2, p: 2, t: '10', r: '講堂', y: 2026 }),
		);
		expect(cells).toContainEqual(
			expect.objectContaining({ l: '100002', w: 1, p: 1, t: '20', r: '494C&D' }),
		);
	});

	it('時限の見出しが全角の数字でも読む', () => {
		const cells = collectTimetableCells(pageDocument());
		expect(cells).toContainEqual(expect.objectContaining({ l: '100003', w: 3, p: 3 }));
	});

	it('表の外のコマ (集中講義) は、曜日と時限を null にする', () => {
		const cells = collectTimetableCells(pageDocument());
		expect(cells).toContainEqual(expect.objectContaining({ l: '100005', w: null, p: null }));
	});

	it('読み取った内容は、サーバー側の検査を通る', () => {
		const cells = collectTimetableCells(pageDocument());
		const fragment = Buffer.from(JSON.stringify({ v: 1, c: cells }), 'utf8').toString('base64url');
		const result = decodeImportFragment(fragment);
		if (result.kind !== 'ok') throw new Error(`通るはず: ${JSON.stringify(result)}`);
		expect(result.rejected).toBe(0);
		expect(result.cells).toHaveLength(5);
		// 教室が空のコマは、名前の末尾から取り出す
		expect(result.cells.find((c) => c.lessonId === '100003')?.room).toBe('R791');
		// hope.fun.ac.jp 以外の URL は捨てる
		expect(result.cells.find((c) => c.lessonId === '100004')?.hopeUrl).toBeNull();
	});
});

describe('buildBookmarklet', () => {
	const bookmarklet = buildBookmarklet('https://funmary.example.com');

	it('javascript: で始まる、1 行の文字列にする', () => {
		expect(bookmarklet.startsWith('javascript:')).toBe(true);
		expect(bookmarklet).not.toContain('\n');
	});

	it('取り込み先は、渡した公開 URL の取り込みの画面だけ', () => {
		expect(bookmarklet).toContain(encodeURIComponent(`https://funmary.example.com${IMPORT_PATH}#`));
	});

	it('ポータル以外のページで押したら、何も送らずに知らせる', () => {
		expect(bookmarklet).toContain(encodeURIComponent('students.fun.ac.jp'));
	});

	it('公開 URL は https か localhost の http だけを受け付ける', () => {
		expect(() => buildBookmarklet('javascript:alert(1)')).toThrow();
		expect(() => buildBookmarklet('http://evil.example')).toThrow();
		expect(() => buildBookmarklet('http://localhost:5173')).not.toThrow();
	});

	it('ブックマークレットの中の関数を、ポータルのページで動かすと、同じ内容の URL へ移る', () => {
		const document = pageDocument();
		let assigned = '';
		const location = {
			hostname: 'students.fun.ac.jp',
			pathname: '/Pt/TimeTable',
			assign: (url: string) => {
				assigned = url;
			},
		};
		const source = decodeURIComponent(bookmarklet.slice('javascript:'.length));
		runBookmarklet(source, { document, location, alert: () => undefined });
		expect(assigned.startsWith(`https://funmary.example.com${IMPORT_PATH}#`)).toBe(true);
		const result = decodeImportFragment(assigned.split('#')[1]!);
		expect(result.kind).toBe('ok');
	});

	it('ポータル以外のページでは、移らない', () => {
		const document = pageDocument();
		let assigned = '';
		const alerts: string[] = [];
		const source = decodeURIComponent(bookmarklet.slice('javascript:'.length));
		runBookmarklet(source, {
			document,
			location: { hostname: 'evil.example', pathname: '/', assign: (u: string) => (assigned = u) },
			alert: (m) => alerts.push(m),
		});
		expect(assigned).toBe('');
		expect(alerts).toHaveLength(1);
	});
});
