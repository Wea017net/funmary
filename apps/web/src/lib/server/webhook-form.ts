// Webhook の登録と更新のフォームを読む (設計書 14.3)。
import type { NotificationKind } from '@funmary/db';
import { isDiscordWebhookUrl } from '@funmary/notify';
import { parseChannelKinds } from './channel-kind-form.ts';

const MAX_LABEL = 40;

export type WebhookFormResult<T> =
	({ readonly ok: true } & T) | { readonly ok: false; readonly error: string };

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
	const kinds = parseChannelKinds(form);
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
	const kinds = parseChannelKinds(form);
	if (!kinds) return { ok: false, error: '送る通知の種類を、1 つ以上選んでください。' };
	return { ok: true, label, kinds };
}

/** 操作する Webhook の ID */
export function parseWebhookId(form: FormData): number | null {
	const id = form.get('id');
	return typeof id === 'string' && /^\d{1,9}$/.test(id) ? Number(id) : null;
}
