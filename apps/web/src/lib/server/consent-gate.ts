// 利用規約への再同意を求めている間に、同意の画面へ送る画面と、そうでない画面の振り分け。
// 同意するまで、アプリの画面 (/app) と、ログインの Cookie で使うほかの画面は、すべて止める。
// ログイン、規約の本文、ロゴなど、同意するために要るものと、Cookie を使わない口 (公開 API、MCP、購読) は、ここでは止めない
// (公開 API と MCP と購読の口は、それぞれの口が、持ち主の同意を確かめる)。

/** 同意するまで使えない画面のパス (これ自身か、この下) */
const GATED_PREFIXES = ['/app', '/oauth/authorize'] as const;

export function needsConsent(path: string): boolean {
	return GATED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** 同意の画面。同意したあとに戻る先を、next に付ける */
export function consentPath(returnTo: {
	readonly pathname: string;
	readonly search: string;
}): string {
	return `/consent?next=${encodeURIComponent(`${returnTo.pathname}${returnTo.search}`)}`;
}

const DEFAULT_NEXT = '/app';

/**
 * 同意のあとに戻る先。このサイトの中のパスだけを通す (別のサイトに飛ばされないように)。
 * 同意の画面自身は避ける。値が正しくなければ /app
 */
export function safeNextPath(value: string | null): string {
	if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
		return DEFAULT_NEXT;
	}
	if ([...value].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) {
		return DEFAULT_NEXT;
	}
	if (value === '/consent' || value.startsWith('/consent?') || value.startsWith('/consent/')) {
		return DEFAULT_NEXT;
	}
	return value;
}
