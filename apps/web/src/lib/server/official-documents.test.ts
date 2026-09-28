import { describe, expect, it } from 'vitest';
import { loadOfficialDocuments, OFFICIAL_CALENDAR_KEY } from './official-documents.ts';

const URL_OK = 'https://www.fun.ac.jp/wp/wp-content/uploads/2026AcademicCalendar.pdf';
const settings = (value: unknown) => ({
	get: (key: string) => (key === OFFICIAL_CALENDAR_KEY ? value : null),
});

describe('loadOfficialDocuments', () => {
	it('記録された学年暦の PDF を、年度とあわせて返す', () => {
		expect(loadOfficialDocuments(settings({ year: 2026, url: URL_OK }))).toEqual([
			{ title: '2026 年度の学年暦', url: URL_OK },
		]);
	});

	it('記録がなければ、何も返さない (壊れたリンクを出さない)', () => {
		expect(loadOfficialDocuments(settings(null))).toEqual([]);
	});

	it.each([
		['形が違う', { year: '2026', url: URL_OK }],
		['大学サイト以外', { year: 2026, url: 'https://example.com/a.pdf' }],
		['https でない', { year: 2026, url: 'http://www.fun.ac.jp/a.pdf' }],
		['PDF でない', { year: 2026, url: 'https://www.fun.ac.jp/a.html' }],
		['URL でない', { year: 2026, url: 'not a url' }],
	])('%s値は、リンクにしない', (_name, value) => {
		expect(loadOfficialDocuments(settings(value))).toEqual([]);
	});
});
