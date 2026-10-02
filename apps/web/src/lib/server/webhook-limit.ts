// 利用者が登録できる Webhook の個数の上限 (設計書 14.3.1)。管理者が管理画面で決め、DB の settings に置く
export const WEBHOOKS_PER_USER_KEY = 'webhooks-per-user';
export const DEFAULT_WEBHOOK_LIMIT = 5;
export const MAX_WEBHOOK_LIMIT = 50;

/** 保存された値を読む。形が違うときは既定の 5 個にする */
export function readWebhookLimit(value: unknown): number {
	if (typeof value !== 'object' || value === null) return DEFAULT_WEBHOOK_LIMIT;
	const { limit } = value as { limit?: unknown };
	return typeof limit === 'number' &&
		Number.isInteger(limit) &&
		limit >= 0 &&
		limit <= MAX_WEBHOOK_LIMIT
		? limit
		: DEFAULT_WEBHOOK_LIMIT;
}

/** 管理画面のフォームの値。0 から MAX_WEBHOOK_LIMIT までの整数だけ受け付ける */
export function parseWebhookLimit(value: FormDataEntryValue | null): number | null {
	if (typeof value !== 'string' || !/^\d{1,3}$/.test(value.trim())) return null;
	const limit = Number(value);
	return limit <= MAX_WEBHOOK_LIMIT ? limit : null;
}
