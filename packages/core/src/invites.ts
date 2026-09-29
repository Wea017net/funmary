// 招待コードを発行できるかどうかの判定 (設計書 8.2)。発行できる人は、管理画面で 3 つのモードから選ぶ。
// 将来、モデレーターなどのロールを足すときは、ロールを権限の組として定義し、ここの判定に権限を渡す。
// I/O は持たない。設定、権限、今月の発行数は引数で受け取る。

/** 発行できる人。admin は管理者のみ、permitted は管理者と発行の権限を持つ人、anyone はログインしている全員 */
export type InviteIssuers = 'admin' | 'permitted' | 'anyone';

export const INVITE_ISSUERS: readonly InviteIssuers[] = ['admin', 'permitted', 'anyone'];

/** 利用者ごとに付ける権限。今は招待コードの発行だけ */
export type Permission = 'invite:create';

export interface InviteSettings {
	readonly issuers: InviteIssuers;
	/** 管理者でない人が、1 か月 (日本時間の暦の月) に発行できる数 */
	readonly monthlyLimit: number;
}

export const DEFAULT_INVITE_SETTINGS: InviteSettings = { issuers: 'admin', monthlyLimit: 5 };

/** 管理者でない人が発行するコードは、1 回だけ使えて、この日数で期限が切れる */
export const MEMBER_INVITE_MAX_USES = 1;
export const MEMBER_INVITE_DAYS = 30;

export interface InviteIssuer {
	readonly role: 'user' | 'moderator' | 'admin';
	readonly permissions: readonly Permission[];
}

export type InviteIssuance =
	/** 管理者。使用回数と期限を決めて、上限なく発行できる */
	| { readonly kind: 'admin' }
	/** 管理者でない人。決まった条件のコードを、残りの数まで発行できる */
	| { readonly kind: 'member'; readonly remaining: number }
	| { readonly kind: 'limit-reached'; readonly limit: number }
	| { readonly kind: 'not-allowed' };

export function inviteIssuance(
	issuer: InviteIssuer,
	settings: InviteSettings,
	issuedThisMonth: number,
): InviteIssuance {
	if (issuer.role === 'admin') return { kind: 'admin' };
	const allowed =
		settings.issuers === 'anyone' ||
		(settings.issuers === 'permitted' && issuer.permissions.includes('invite:create'));
	if (!allowed) return { kind: 'not-allowed' };
	const remaining = settings.monthlyLimit - issuedThisMonth;
	return remaining > 0
		? { kind: 'member', remaining }
		: { kind: 'limit-reached', limit: settings.monthlyLimit };
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間で now を含む月の、1 日の 0 時 */
export function startOfJstMonth(now: Date): Date {
	const jst = new Date(now.getTime() + JST_OFFSET_MS);
	return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1) - JST_OFFSET_MS);
}
