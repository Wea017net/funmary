// 利用者が自分の時間割に足した予定の保存 (Issue #144、#145)。
// 持ち主は、自分の予定を読み書きできる。ほかの人が見られるのは、公開範囲で許された予定だけで、持ち主の情報は返さない。
// 繰り返しは RRULE の文字列のまま保存し、展開は @funmary/core が行う。
import { randomBytes } from 'node:crypto';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import type { EventTime, UserEvent } from '@funmary/core';
import type { Database } from './database.ts';
import { accessGrants, eventSubscriptions, userEvents } from './schema.ts';

/** private は本人だけ、link は共有のリンクを知っている人、public はログインしている全員 */
export type EventVisibility = 'private' | 'link' | 'public';

export type UserEventInput = Omit<UserEvent, 'id'> & { readonly visibility: EventVisibility };

/** 持ち主が読む予定。公開範囲と、共有のリンクの値を持つ */
export interface UserEventRecord extends UserEvent {
	readonly visibility: EventVisibility;
	/** 限定公開のときだけある */
	readonly shareToken: string | null;
}

/** ほかの人に見せる予定。持ち主の情報は含めない */
export interface SharedEvent {
	readonly event: UserEvent;
	readonly visibility: EventVisibility;
	readonly isOwner: boolean;
	/** 自分の時間割に加えている */
	readonly subscribed: boolean;
}

export interface UserEventStore {
	/** 予定を足し、その ID を返す */
	create(ownerId: string, input: UserEventInput, now: Date): number;
	/** 持ち主の予定を直す。持ち主でなければ、何もせず false */
	update(id: number, ownerId: string, input: UserEventInput, now: Date): boolean;
	/** 持ち主の予定を消す。持ち主でなければ、何もせず false */
	delete(id: number, ownerId: string): boolean;
	/** 持ち主の予定。持ち主でなければ null */
	get(id: number, ownerId: string): UserEventRecord | null;
	/** 持ち主の予定を、始まりの日の順に返す */
	listByOwner(ownerId: string): UserEventRecord[];
	/** 共有のリンクを作り直す。前のリンクは使えなくなる。限定公開でない、または持ち主でなければ false */
	rotateShareToken(id: number, ownerId: string): boolean;
	/**
	 * viewer の人が開ける予定。ref は共有のリンクの値か、予定の番号。
	 * リンクの値では限定公開の予定を、番号では全体に公開された予定と、自分の予定を開ける。
	 * 非公開でも、viewer のメールアドレスが招待されていれば開ける (#215)
	 */
	findShared(
		ref: string,
		viewer: { readonly id: string; readonly email: string },
	): SharedEvent | null;
	/** 全体に公開された予定 (自分の予定を除く) を、始まりの日の順に返す */
	listPublic(viewerId: string): SharedEvent[];
	/**
	 * ほかの人の予定を、自分の時間割に加える。
	 * 加えられない (自分の予定、見られない、ない) なら false
	 */
	subscribe(
		user: { readonly id: string; readonly email: string },
		eventId: number,
		now: Date,
	): boolean;
	unsubscribe(userId: string, eventId: number): boolean;
	/** 加えた予定のうち、いま見られるもの。持ち主が非公開にして、招待も外したら含めない */
	listSubscribed(viewer: { readonly id: string; readonly email: string }): UserEvent[];
}

type Row = typeof userEvents.$inferSelect;

function toTime(row: Row): EventTime {
	if (row.timeKind === 'time' && row.startTime && row.endTime) {
		return { kind: 'time', start: row.startTime, end: row.endTime };
	}
	if (row.timeKind === 'period' && row.startPeriod !== null && row.endPeriod !== null) {
		return { kind: 'period', from: row.startPeriod, to: row.endPeriod };
	}
	return { kind: 'allDay' };
}

const toEvent = (row: Row): UserEvent => ({
	id: row.id,
	title: row.title,
	location: row.location,
	notes: row.notes,
	startDate: row.startDate,
	endDate: row.endDate,
	time: toTime(row),
	rrule: row.rrule,
	excludedDates: row.excludedDates,
});

const toRecord = (row: Row): UserEventRecord => ({
	...toEvent(row),
	visibility: row.visibility,
	shareToken: row.shareToken,
});

const newShareToken = () => randomBytes(32).toString('base64url');

function toColumns(input: UserEventInput) {
	return {
		title: input.title,
		location: input.location,
		notes: input.notes,
		startDate: input.startDate,
		endDate: input.endDate,
		timeKind: input.time.kind,
		startTime: input.time.kind === 'time' ? input.time.start : null,
		endTime: input.time.kind === 'time' ? input.time.end : null,
		startPeriod: input.time.kind === 'period' ? input.time.from : null,
		endPeriod: input.time.kind === 'period' ? input.time.to : null,
		rrule: input.rrule,
		excludedDates: [...input.excludedDates],
		visibility: input.visibility,
	};
}

export function createUserEventStore(database: Database): UserEventStore {
	const { db } = database;
	const owned = (id: number, ownerId: string) =>
		and(eq(userEvents.id, id), eq(userEvents.ownerId, ownerId));
	const subscribedIds = (userId: string) =>
		new Set(
			db
				.select({ id: eventSubscriptions.eventId })
				.from(eventSubscriptions)
				.where(eq(eventSubscriptions.userId, userId))
				.all()
				.map((row) => row.id),
		);
	const isGrantedTo = (eventId: number, email: string) =>
		db
			.select()
			.from(accessGrants)
			.where(
				and(
					eq(accessGrants.resourceType, 'event'),
					eq(accessGrants.resourceId, eventId),
					eq(accessGrants.granteeEmail, email.trim().toLowerCase()),
				),
			)
			.get() !== undefined;

	return {
		create(ownerId, input, now) {
			return db
				.insert(userEvents)
				.values({
					ownerId,
					...toColumns(input),
					shareToken: input.visibility === 'link' ? newShareToken() : null,
					createdAt: now,
					updatedAt: now,
				})
				.returning({ id: userEvents.id })
				.get().id;
		},
		update(id, ownerId, input, now) {
			const current = db.select().from(userEvents).where(owned(id, ownerId)).get();
			if (!current) return false;
			// 限定公開のままなら、リンクの値は変えない。限定公開でなくなったら、リンクは使えなくする
			const shareToken =
				input.visibility === 'link' ? (current.shareToken ?? newShareToken()) : null;
			db.update(userEvents)
				.set({ ...toColumns(input), shareToken, updatedAt: now })
				.where(owned(id, ownerId))
				.run();
			return true;
		},
		delete(id, ownerId) {
			return db.delete(userEvents).where(owned(id, ownerId)).run().changes > 0;
		},
		get(id, ownerId) {
			const row = db.select().from(userEvents).where(owned(id, ownerId)).get();
			return row ? toRecord(row) : null;
		},
		listByOwner(ownerId) {
			return db
				.select()
				.from(userEvents)
				.where(eq(userEvents.ownerId, ownerId))
				.orderBy(asc(userEvents.startDate), asc(userEvents.id))
				.all()
				.map(toRecord);
		},
		rotateShareToken(id, ownerId) {
			return (
				db
					.update(userEvents)
					.set({ shareToken: newShareToken() })
					.where(and(owned(id, ownerId), eq(userEvents.visibility, 'link')))
					.run().changes > 0
			);
		},
		findShared(ref, viewer) {
			const byId = /^[1-9]\d{0,9}$/.test(ref)
				? db
						.select()
						.from(userEvents)
						.where(eq(userEvents.id, Number(ref)))
						.get()
				: undefined;
			const row = byId ?? db.select().from(userEvents).where(eq(userEvents.shareToken, ref)).get();
			if (!row) return null;
			const isOwner = row.ownerId === viewer.id;
			// 番号で開けるのは、全体に公開された予定と、自分の予定だけ。限定公開の予定は、リンクの値でだけ開ける
			const byToken = row.shareToken !== null && row.shareToken === ref;
			const granted = !isOwner && isGrantedTo(row.id, viewer.email);
			if (!isOwner && !granted && !byToken && row.visibility !== 'public') return null;
			if (!isOwner && !granted && row.visibility === 'private') return null;
			return {
				event: toEvent(row),
				visibility: row.visibility,
				isOwner,
				subscribed: subscribedIds(viewer.id).has(row.id),
			};
		},
		listPublic(viewerId) {
			const subscribed = subscribedIds(viewerId);
			return db
				.select()
				.from(userEvents)
				.where(and(eq(userEvents.visibility, 'public'), ne(userEvents.ownerId, viewerId)))
				.orderBy(asc(userEvents.startDate), asc(userEvents.id))
				.all()
				.map((row) => ({
					event: toEvent(row),
					visibility: row.visibility,
					isOwner: false,
					subscribed: subscribed.has(row.id),
				}));
		},
		subscribe(user, eventId, now) {
			const row = db.select().from(userEvents).where(eq(userEvents.id, eventId)).get();
			if (!row || row.ownerId === user.id) return false;
			if (row.visibility === 'private' && !isGrantedTo(eventId, user.email)) return false;
			db.insert(eventSubscriptions)
				.values({ userId: user.id, eventId, createdAt: now })
				.onConflictDoNothing()
				.run();
			return true;
		},
		unsubscribe(userId, eventId) {
			return (
				db
					.delete(eventSubscriptions)
					.where(
						and(eq(eventSubscriptions.userId, userId), eq(eventSubscriptions.eventId, eventId)),
					)
					.run().changes > 0
			);
		},
		listSubscribed(viewer) {
			const ids = [...subscribedIds(viewer.id)];
			if (ids.length === 0) return [];
			return db
				.select()
				.from(userEvents)
				.where(inArray(userEvents.id, ids))
				.orderBy(asc(userEvents.startDate), asc(userEvents.id))
				.all()
				.filter((row) => row.visibility !== 'private' || isGrantedTo(row.id, viewer.email))
				.map(toEvent);
		},
	};
}
