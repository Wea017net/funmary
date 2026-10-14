// アクセストークンから、自分の通知を既読にする。公開 API (REST) と MCP が同じ関数を呼ぶ。
// 書き込みは、どのトークンからかを、利用者が見られる履歴に残す。
import type { ApiActivityStore, NotificationStore, StoredNotification } from '@funmary/db';
import type { WriteActor } from './events.ts';

export interface NotificationWriteSources {
	readonly notifications: Pick<NotificationStore, 'markRead' | 'markAllRead'>;
	readonly activity: Pick<ApiActivityStore, 'record'>;
}

export function markNotificationRead(
	sources: NotificationWriteSources,
	actor: WriteActor,
	id: number,
	now: Date,
):
	| { readonly ok: true; readonly notification: StoredNotification }
	| { readonly ok: false; readonly kind: 'not_found'; readonly error: string } {
	const notification = sources.notifications.markRead(actor.userId, id, now);
	if (!notification) return { ok: false, kind: 'not_found', error: '通知が見つかりません' };
	sources.activity.record(
		{
			...actor,
			action: 'notification.read',
			targetId: id,
			summary: `通知「${notification.title}」を既読にした`,
		},
		now,
	);
	return { ok: true, notification };
}

/** 未読をすべて既読にして、その件数を返す。未読がなければ、履歴には残さない */
export function markAllNotificationsRead(
	sources: NotificationWriteSources,
	actor: WriteActor,
	now: Date,
): { readonly ok: true; readonly count: number } {
	const count = sources.notifications.markAllRead(actor.userId, now);
	if (count > 0) {
		sources.activity.record(
			{
				...actor,
				action: 'notification.readAll',
				targetId: null,
				summary: `通知 ${count} 件を、すべて既読にした`,
			},
			now,
		);
	}
	return { ok: true, count };
}
