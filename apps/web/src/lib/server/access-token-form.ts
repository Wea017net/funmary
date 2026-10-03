// 公開 API と MCP サーバー向けの個人用アクセストークンの発行フォームを読む (設計書 3.3)。
import { ACCESS_TOKEN_SCOPES, type AccessTokenScope } from '@funmary/db';

const MAX_NAME = 50;
/** 既定 90 日、最長 1 年 */
const DEFAULT_EXPIRES_DAYS = 90;
const MAX_EXPIRES_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AccessTokenFormResult<T> =
	({ readonly ok: true } & T) | { readonly ok: false; readonly error: string };

function readScopes(form: FormData): AccessTokenScope[] | null {
	const values = form.getAll('scopes');
	const scopes = values.filter(
		(value): value is AccessTokenScope =>
			typeof value === 'string' && (ACCESS_TOKEN_SCOPES as readonly string[]).includes(value),
	);
	return scopes.length > 0 ? scopes : null;
}

export function parseAccessTokenIssue(
	form: FormData,
	now: Date,
): AccessTokenFormResult<{ name: string; scopes: AccessTokenScope[]; expiresAt: Date }> {
	const name = form.get('name');
	if (typeof name !== 'string' || name.trim() === '') {
		return { ok: false, error: '名前 (どこで使うか) を入れてください。' };
	}
	const trimmed = name.trim();
	if (trimmed.length > MAX_NAME) {
		return { ok: false, error: `名前は ${MAX_NAME} 文字までにしてください。` };
	}
	const scopes = readScopes(form);
	if (!scopes) return { ok: false, error: '読める範囲を、1 つ以上選んでください。' };
	const daysRaw = form.get('expiresInDays');
	const days = typeof daysRaw === 'string' ? Number(daysRaw) : NaN;
	if (!Number.isInteger(days) || days < 1 || days > MAX_EXPIRES_DAYS) {
		return { ok: false, error: `有効期限は 1〜${MAX_EXPIRES_DAYS} 日で選んでください。` };
	}
	return { ok: true, name: trimmed, scopes, expiresAt: new Date(now.getTime() + days * DAY_MS) };
}

export function parseAccessTokenId(form: FormData): number | null {
	const id = Number(form.get('id'));
	return Number.isInteger(id) && id > 0 ? id : null;
}

export const ACCESS_TOKEN_EXPIRES_OPTIONS = [
	{ days: 30, label: '30 日' },
	{ days: DEFAULT_EXPIRES_DAYS, label: '90 日 (既定)' },
	{ days: 180, label: '180 日' },
	{ days: MAX_EXPIRES_DAYS, label: '1 年' },
] as const;

export const ACCESS_TOKEN_SCOPE_OPTIONS: readonly { scope: AccessTokenScope; label: string }[] = [
	{ scope: 'read:lessons', label: '今日や週の授業' },
	{ scope: 'read:changes', label: '休講、補講、教室変更' },
	{ scope: 'read:notifications', label: '通知欄' },
];
