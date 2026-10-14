// アクセストークンから、自分の予定を足す、直す、消す。公開 API (REST) と MCP が同じ関数を呼ぶ。
// 検査は、画面のフォームと同じもの (@funmary/core の parseEventFields) を通す。公開範囲は、足すときは非公開にし、直すときは変えない。
// 書き込みは、どのトークンからかを、利用者が見られる履歴に残す。
import { parseEventFields } from '@funmary/core';
import type { AccessGrantStore, ApiActivityStore, UserEventStore } from '@funmary/db';
import { eventBodyToFields, eventToBody, type EventBody, type EventResult } from './event-json.ts';

export interface EventWriteSources {
	readonly userEvents: Pick<UserEventStore, 'create' | 'update' | 'delete' | 'get'>;
	readonly accessGrants: Pick<AccessGrantStore, 'revokeAll'>;
	readonly activity: Pick<ApiActivityStore, 'record'>;
}

/** 書き込んだトークン。履歴に残す */
export interface WriteActor {
	readonly userId: string;
	/** 取り消されたあとの記録のために、null も許す */
	readonly tokenId: number | null;
	readonly tokenName: string;
}

export type EventWriteFailure = {
	readonly ok: false;
	readonly kind: 'invalid' | 'not_found';
	readonly error: string;
};

const NOT_FOUND: EventWriteFailure = {
	ok: false,
	kind: 'not_found',
	error: '予定が見つかりません',
};

/** 自分の予定 1 件。ほかの人の予定は、見つからないことにする */
export function getEvent(
	sources: Pick<EventWriteSources, 'userEvents'>,
	userId: string,
	id: number,
): EventResult | null {
	const event = sources.userEvents.get(id, userId);
	return event ? eventToBody(event) : null;
}

export function createEvent(
	sources: EventWriteSources,
	actor: WriteActor,
	body: EventBody,
	now: Date,
): { readonly ok: true; readonly event: EventResult } | EventWriteFailure {
	const parsed = parseEventFields(eventBodyToFields(body));
	if (!parsed.ok) return { ok: false, kind: 'invalid', error: parsed.error };
	// 公開範囲は、API からは決めさせない。常に非公開で足す
	const input = { ...parsed.value, visibility: 'private' as const };
	const id = sources.userEvents.create(actor.userId, input, now);
	sources.activity.record(
		{
			...actor,
			action: 'event.create',
			targetId: id,
			summary: `予定「${input.title}」を足した`,
		},
		now,
	);
	return { ok: true, event: eventToBody({ id, ...input }) };
}

/** 予定を、送られた内容に置き換える。公開範囲は変えない */
export function replaceEvent(
	sources: EventWriteSources,
	actor: WriteActor,
	id: number,
	body: EventBody,
	now: Date,
): { readonly ok: true; readonly event: EventResult } | EventWriteFailure {
	const current = sources.userEvents.get(id, actor.userId);
	if (!current) return NOT_FOUND;
	const parsed = parseEventFields(eventBodyToFields(body));
	if (!parsed.ok) return { ok: false, kind: 'invalid', error: parsed.error };
	const input = { ...parsed.value, visibility: current.visibility };
	if (!sources.userEvents.update(id, actor.userId, input, now)) return NOT_FOUND;
	sources.activity.record(
		{
			...actor,
			action: 'event.update',
			targetId: id,
			summary: `予定「${input.title}」を直した`,
		},
		now,
	);
	return { ok: true, event: eventToBody({ id, ...input }) };
}

export function deleteEvent(
	sources: EventWriteSources,
	actor: WriteActor,
	id: number,
	now: Date,
): { readonly ok: true } | EventWriteFailure {
	const current = sources.userEvents.get(id, actor.userId);
	if (!current || !sources.userEvents.delete(id, actor.userId)) return NOT_FOUND;
	// 画面の削除と同じく、招待も外す
	sources.accessGrants.revokeAll('event', id);
	sources.activity.record(
		{
			...actor,
			action: 'event.delete',
			targetId: id,
			summary: `予定「${current.title}」を消した`,
		},
		now,
	);
	return { ok: true };
}
