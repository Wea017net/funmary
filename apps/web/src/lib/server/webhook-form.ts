// Webhook の登録と更新のフォームを読む (設計書 14.3)。
import type { NotificationKind } from '@funmary/db';
import { isDiscordWebhookUrl } from '@funmary/notify';

/** Webhook に送る通知の種類の選択肢 */
export const WEBHOOK_KIND_OPTIONS: readonly { kind: NotificationKind; label: string }[] = [
	{ kind: 'cancellation', label: '休講' },
	{ kind: 'makeup', label: '補講' },
	{ kind: 'roomChange', label: '教室変更' },
	{ kind: 'integration', label: '連携の不具合' },
];

const MAX_LABEL = 40;

export type WebhookFormResult<T> =
	({ readonly ok: true } & T) | { readonly ok: false; readonly error: string };

function readKinds(form: FormData): NotificationKind[] | null {
	const chosen = form.getAll('kinds');
	const kinds = WEBHOOK_KIND_OPTIONS.map((option) => option.kind).filter((kind) =>
		chosen.includes(kind),
	);
	return kinds.length > 0 ? kinds : null;
}

function readLabel(form: FormData): string | null | undefined {
	const label = form.get('label');
	if (label === null) return null;
	if (typeof label !== 'string') return undefined;
	const trimmed = label.trim();
	if (trimmed.length > MAX_LABEL) return undefined;
	return trimmed === '' ? null : trimmed;
}

export function parseWebhookCreate(form: FormData): WebhookFormResult<{
	url: string;
	label: string | null;
	kinds: NotificationKind[];
}> {
	const url = form.get('url');
	if (typeof url !== 'string' || !isDiscordWebhookUrl(url.trim())) {
		return {
			ok: false,
			error:
				'Discord の Webhook の URL (https://discord.com/api/webhooks/ で始まるもの) を入れてください。',
		};
	}
	const label = readLabel(form);
	if (label === undefined)
		return { ok: false, error: `名前は ${MAX_LABEL} 文字までにしてください。` };
	const kinds = readKinds(form);
	if (!kinds) return { ok: false, error: '送る通知の種類を、1 つ以上選んでください。' };
	return { ok: true, url: url.trim(), label, kinds };
}

export function parseWebhookUpdate(form: FormData): WebhookFormResult<{
	label: string | null;
	kinds: NotificationKind[];
}> {
	const label = readLabel(form);
	if (label === undefined)
		return { ok: false, error: `名前は ${MAX_LABEL} 文字までにしてください。` };
	const kinds = readKinds(form);
	if (!kinds) return { ok: false, error: '送る通知の種類を、1 つ以上選んでください。' };
	return { ok: true, label, kinds };
}

/** 操作する Webhook の ID */
export function parseWebhookId(form: FormData): number | null {
	const id = form.get('id');
	return typeof id === 'string' && /^\d{1,9}$/.test(id) ? Number(id) : null;
}
