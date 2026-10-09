/** 招待コードの入力欄の最大の長さ (Landing の maxlength と同じ) */
const MAX_LENGTH = 100;

/** 紹介の画面の URL の ?code= から、入力欄に入れる招待コードを取り出す。ないか、空なら null */
export function parseInviteCodeParam(value: string | null): string | null {
	const code = value?.trim().slice(0, MAX_LENGTH) ?? '';
	return code === '' ? null : code;
}
