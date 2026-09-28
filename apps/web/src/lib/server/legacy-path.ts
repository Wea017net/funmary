// アプリの画面は /app の下に移した (紹介の画面を / に置くため)。前の URL を、移した先の URL にする。
// ブックマークや、登録済みのブックマークレット (/courses/import#...) を動かし続けるために使う。
// # 以降はサーバーに届かないが、ブラウザが転送先に引き継ぐ。

const MOVED = ['/week', '/courses', '/subjects', '/admin'];

/** 前の URL なら移した先のパス、そうでなければ null */
export function legacyAppPath(pathname: string): string | null {
	return MOVED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
		? `/app${pathname}`
		: null;
}
