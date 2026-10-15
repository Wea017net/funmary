import { describe, expect, it } from 'vitest';
import { ACADEMIC_INFO_URL, fetchAcademicCalendarPdf, findAcademicCalendarLinks } from './fetch.ts';

const page = (links: string) =>
	`<!doctype html><html><body><main><h2>教育課程</h2><ul>${links}</ul></main></body></html>`;

const LINKS = [
	'<li><a href="https://www.fun.ac.jp/wp/wp-content/uploads/rules.pdf">学則</a></li>',
	'<li><a href="https://www.fun.ac.jp/wp/wp-content/uploads/2026AcademicCalendar.pdf">2026学年暦</a></li>',
	'<li><a href="/wp/wp-content/uploads/2025AcademicCalendar.pdf">2025 学年暦</a></li>',
	'<li><a href="https://evil.example.com/2027.pdf">2027学年暦</a></li>',
	'<li><a href="http://www.fun.ac.jp/2028.pdf">2028学年暦</a></li>',
].join('');

describe('findAcademicCalendarLinks', () => {
	it('「(年)学年暦」のリンクを、大学サイトの https の PDF だけ、新しい年から並べる', () => {
		expect(findAcademicCalendarLinks(page(LINKS))).toEqual([
			{ year: 2026, url: 'https://www.fun.ac.jp/wp/wp-content/uploads/2026AcademicCalendar.pdf' },
			{ year: 2025, url: 'https://www.fun.ac.jp/wp/wp-content/uploads/2025AcademicCalendar.pdf' },
		]);
	});

	it('見つからなければ空', () => {
		expect(findAcademicCalendarLinks(page('<li><a href="/a.pdf">学則</a></li>'))).toEqual([]);
	});
});

const PDF = new TextEncoder().encode('%PDF-1.7\n...');

function fakeFetch(routes: Record<string, () => Response>) {
	const calls: string[] = [];
	return {
		calls,
		fetch: (url: string) => {
			calls.push(url);
			const route = routes[url];
			return Promise.resolve(route ? route() : new Response('not found', { status: 404 }));
		},
	};
}

const html = (body: string) =>
	new Response(body, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
const pdf = () => new Response(PDF, { headers: { 'Content-Type': 'application/pdf' } });

describe('fetchAcademicCalendarPdf', () => {
	it('ページから、いちばん新しい年の学年暦の PDF を取る', async () => {
		const { fetch, calls } = fakeFetch({
			[ACADEMIC_INFO_URL]: () => html(page(LINKS)),
			'https://www.fun.ac.jp/wp/wp-content/uploads/2026AcademicCalendar.pdf': pdf,
		});
		const result = await fetchAcademicCalendarPdf({ fetch });
		expect(result).toEqual({
			kind: 'ok',
			year: 2026,
			url: 'https://www.fun.ac.jp/wp/wp-content/uploads/2026AcademicCalendar.pdf',
			bytes: PDF,
		});
		expect(calls).toHaveLength(2);
	});

	it('リンクがない、PDF でない、HTTP のエラーは、失敗として返す (例外にしない)', async () => {
		const failure = async (deps: Parameters<typeof fetchAcademicCalendarPdf>[0]) => {
			const result = await fetchAcademicCalendarPdf(deps);
			return result.kind === 'failed' ? result.message : null;
		};
		expect(await failure(fakeFetch({ [ACADEMIC_INFO_URL]: () => html(page('')) }))).toMatch(
			'リンクが見つかりません',
		);
		expect(
			await failure(
				fakeFetch({
					[ACADEMIC_INFO_URL]: () => html(page(LINKS)),
					'https://www.fun.ac.jp/wp/wp-content/uploads/2026AcademicCalendar.pdf': () =>
						html('<html></html>'),
				}),
			),
		).toMatch('PDF ではありません');
		expect(await failure(fakeFetch({}))).toMatch('HTTP 404');
		expect(await failure({ fetch: () => Promise.reject(new Error('ECONNRESET')) })).toMatch(
			'ECONNRESET',
		);
	});
});
