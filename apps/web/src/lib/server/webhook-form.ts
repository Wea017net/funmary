// Webhook の登録と更新のフォームを読む (設計書 14.3、14.3.1)。
import type { NotificationKind, WebhookKind } from '@funmary/db';
import { checkWebhookUrl, isDiscordWebhookUrl } from '@funmary/notify';
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

function readKind(form: FormData): WebhookKind | null {
	const kind = form.get('kind');
	return kind === 'discord' || kind === 'generic' ? kind : null;
}

/** 種類に合う URL かを確かめる。discord は Discord の Webhook の URL だけ、generic は https で決まったポートだけ */
function checkUrl(kind: WebhookKind, url: string): { ok: true } | { ok: false; reason: string } {
	if (kind === 'discord') {
		return isDiscordWebhookUrl(url)
			? { ok: true }
			: {
					ok: false,
					reason:
						'Discord の Webhook の URL (https://discord.com/api/webhooks/ で始まるもの) を入れてください。',
				};
	}
	return checkWebhookUrl(url);
}

export function parseWebhookCreate(form: FormData): WebhookFormResult<{
	kind: WebhookKind;
	url: string;
	label: string | null;
	kinds: NotificationKind[];
}> {
	const kind = readKind(form);
	if (!kind) return { ok: false, error: '種類を選んでください。' };
	const url = form.get('url');
	if (typeof url !== 'string' || url.trim() === '') {
		return { ok: false, error: 'URL を入れてください。' };
	}
	const trimmedUrl = url.trim();
	const urlCheck = checkUrl(kind, trimmedUrl);
	if (!urlCheck.ok) return { ok: false, error: urlCheck.reason };
	const label = readLabel(form);
	if (label === undefined)
		return { ok: false, error: `名前は ${MAX_LABEL} 文字までにしてください。` };
	const kinds = parseChannelKinds(form);
	if (!kinds) return { ok: false, error: '送る通知の種類を、1 つ以上選んでください。' };
	return { ok: true, kind, url: trimmedUrl, label, kinds };
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
