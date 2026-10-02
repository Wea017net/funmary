// 通知の送り先に使う Discord の Webhook の設定 (設計書 14.3)。登録、更新、テスト送信、有効と無効の切り替え、削除。
// URL は暗号化して保存し、画面には末尾を伏せて出す。テスト送信は、Webhook の先に連続で送らないよう、利用者ごとに間をあける
import { fail, redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import { DEFAULT_CHANNEL_KINDS } from '@funmary/db';
import { maskWebhookUrl, type SendOutcome } from '@funmary/notify';
import { getServices } from '$lib/server/services.ts';
import {
	parseWebhookCreate,
	parseWebhookId,
	parseWebhookUpdate,
	WEBHOOK_KIND_OPTIONS,
} from '$lib/server/webhook-form.ts';

/** テスト送信と登録の間隔 */
const SEND_COOLDOWN_MS = 10 * 1000;
const lastSendAt = new Map<string, number>();

/** 間があいていなければ、待つ秒数を返す。送れるときは時刻を記録して null */
function claimSend(userId: string, now: number): number | null {
	const last = lastSendAt.get(userId);
	if (last !== undefined && now - last < SEND_COOLDOWN_MS) {
		return Math.ceil((SEND_COOLDOWN_MS - (now - last)) / 1000);
	}
	lastSendAt.set(userId, now);
	return null;
}

const waitMessage = (seconds: number) =>
	`続けて送れません。${seconds} 秒たってから、もう一度お試しください。`;

/** テスト送信の結果を、利用者に見せる文にする。送れたときは null */
function failureMessage(outcome: SendOutcome): string | null {
	switch (outcome.status) {
		case 'sent':
			return null;
		case 'gone':
			return 'Webhook が見つかりません。URL が正しいか、Webhook が削除されていないかを確かめてください。';
		case 'retry':
			return 'Discord に送れませんでした。しばらくしてから、もう一度お試しください。';
		case 'rejected':
			return 'Discord に受け付けられませんでした。URL を確かめてください。';
	}
}

export const load: ServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	const { channels, webhooks } = getServices();
	const list = channels.listWebhooks(locals.user.id);
	return {
		limit: webhooks.limit(),
		count: list.length,
		kindOptions: WEBHOOK_KIND_OPTIONS,
		webhooks: list.map((webhook) => ({
			id: webhook.id,
			label: webhook.label,
			maskedUrl: maskWebhookUrl(webhook.url),
			kinds: [...(webhook.notificationKinds ?? DEFAULT_CHANNEL_KINDS)],
			enabled: webhook.status === 'active',
			disabledReason: webhook.disabledReason,
		})),
	};
};

export const actions: Actions = {
	/** 登録する。テスト通知を送れたものだけを登録する */
	add: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		const { channels, webhooks } = getServices();
		const parsed = parseWebhookCreate(await request.formData());
		if (!parsed.ok) return fail(400, { error: parsed.error });
		const registered = channels.listWebhooks(locals.user.id);
		if (registered.length >= webhooks.limit()) {
			return fail(400, {
				error: `登録できる Webhook は ${webhooks.limit()} 個までです。使わないものを削除してください。`,
			});
		}
		if (registered.some((webhook) => webhook.url === parsed.url)) {
			return fail(400, { error: '同じ Webhook を、すでに登録しています。' });
		}
		const wait = claimSend(locals.user.id, Date.now());
		if (wait !== null) return fail(429, { error: waitMessage(wait) });
		const problem = failureMessage(await webhooks.sendTest(parsed.url));
		if (problem) return fail(400, { error: problem });
		channels.addWebhook(
			locals.user.id,
			{ url: parsed.url, label: parsed.label, notificationKinds: parsed.kinds },
			new Date(),
		);
		return {
			message:
				'Webhook を登録しました。テスト通知が、Discord のチャンネルに届いているか確かめてください。',
		};
	},
	/** 名前と、送る通知の種類を保存する */
	update: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		const form = await request.formData();
		const id = parseWebhookId(form);
		const parsed = parseWebhookUpdate(form);
		if (id === null || !parsed.ok) {
			return fail(400, { error: parsed.ok ? '入力が正しくありません。' : parsed.error });
		}
		const updated = getServices().channels.updateWebhook(locals.user.id, id, {
			label: parsed.label,
			notificationKinds: parsed.kinds,
		});
		if (!updated) return fail(404, { error: 'その Webhook は見つかりません。' });
		return { message: '保存しました。' };
	},
	/** 有効と無効を切り替える。止められていたものを有効に戻すと、止めた理由を消す */
	toggle: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		const form = await request.formData();
		const id = parseWebhookId(form);
		if (id === null) return fail(400, { error: '入力が正しくありません。' });
		const { channels } = getServices();
		const current = channels.findWebhook(locals.user.id, id);
		if (!current) return fail(404, { error: 'その Webhook は見つかりません。' });
		const enable = current.status !== 'active';
		channels.updateWebhook(locals.user.id, id, { enabled: enable });
		return { message: enable ? '有効にしました。' : '無効にしました。' };
	},
	test: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		const id = parseWebhookId(await request.formData());
		if (id === null) return fail(400, { error: '入力が正しくありません。' });
		const { channels, webhooks } = getServices();
		const current = channels.findWebhook(locals.user.id, id);
		if (!current) return fail(404, { error: 'その Webhook は見つかりません。' });
		const wait = claimSend(locals.user.id, Date.now());
		if (wait !== null) return fail(429, { error: waitMessage(wait) });
		const problem = failureMessage(await webhooks.sendTest(current.url));
		if (problem) return fail(400, { error: problem });
		return { message: 'テスト通知を送りました。Discord のチャンネルを確かめてください。' };
	},
	remove: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		const id = parseWebhookId(await request.formData());
		if (id === null) return fail(400, { error: '入力が正しくありません。' });
		if (!getServices().channels.removeWebhook(locals.user.id, id)) {
			return fail(404, { error: 'その Webhook は見つかりません。' });
		}
		return { message: '削除しました。' };
	},
};
