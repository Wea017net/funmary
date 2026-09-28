// 画面のフッターに出す、ブラウザと OS。不具合の報告で聞き直さずに済むようにするための目安。
// 判定は bowser に任せ、サーバーで行う (ブラウザに判定の JavaScript を送らないため)。
import Bowser from 'bowser';

/** UA に書かれた版が実際の版と合わない OS (Windows 11 も NT 10.0、macOS は 10.15 のまま) */
const OS_WITHOUT_VERSION = new Set(['Windows', 'macOS']);

const UNKNOWN = { browser: '不明なブラウザ', os: '不明な OS' };

export function describeUserAgent(userAgent: string | null): { browser: string; os: string } {
	// bowser は空の UA で例外を投げる
	if (!userAgent) return UNKNOWN;
	const { browser, os } = Bowser.parse(userAgent);
	const major = browser.version?.split('.')[0];
	return {
		browser: browser.name ? [browser.name, major].filter(Boolean).join(' ') : UNKNOWN.browser,
		os: os.name
			? [os.name, OS_WITHOUT_VERSION.has(os.name) ? null : os.version].filter(Boolean).join(' ')
			: UNKNOWN.os,
	};
}
