// 大学が公式に配っている PDF へのリンク。定期処理が取れたときに記録した URL を、画面に出す。
// 画面の表示のたびに大学サイトへは通信しない。記録された値は、念のため大学サイトの https の PDF かを確かめる。
import type { SettingsStore } from '@funmary/db';

/** 定期処理が、取れた学年暦の PDF の年度と URL を記録する設定の名前 */
export const OFFICIAL_CALENDAR_KEY = 'official-academic-calendar-pdf';

export interface OfficialDocument {
	readonly title: string;
	readonly url: string;
}

const SITE_HOST = 'www.fun.ac.jp';

function isOfficialPdf(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	try {
		const url = new URL(value);
		return (
			url.protocol === 'https:' &&
			url.hostname === SITE_HOST &&
			url.pathname.toLowerCase().endsWith('.pdf')
		);
	} catch {
		return false;
	}
}

export function loadOfficialDocuments(settings: Pick<SettingsStore, 'get'>): OfficialDocument[] {
	const calendar = settings.get(OFFICIAL_CALENDAR_KEY);
	if (typeof calendar !== 'object' || calendar === null) return [];
	const { year, url } = calendar as { year?: unknown; url?: unknown };
	if (typeof year !== 'number' || !Number.isInteger(year) || !isOfficialPdf(url)) return [];
	return [{ title: `${year} 年度の学年暦`, url }];
}
