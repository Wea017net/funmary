// 利用者が自分の時間割に足した予定の保存 (Issue #144)。ここでは、持ち主だけが読み書きできる。
// 公開範囲 (#145) は、別に足す。繰り返しは RRULE の文字列のまま保存し、展開は @funmary/core が行う。
import { and, asc, eq } from 'drizzle-orm';
import type { EventTime, UserEvent } from '@funmary/core';
import type { Database } from './database.ts';
import { userEvents } from './schema.ts';

export type UserEventInput = Omit<UserEvent, 'id'>;

export interface UserEventStore {
	/** 予定を足し、その ID を返す */
	create(ownerId: string, input: UserEventInput, now: Date): number;
	/** 持ち主の予定を直す。持ち主でなければ、何もせず false */
	update(id: number, ownerId: string, input: UserEventInput, now: Date): boolean;
	/** 持ち主の予定を消す。持ち主でなければ、何もせず false */
	delete(id: number, ownerId: string): boolean;
	/** 持ち主の予定。持ち主でなければ null */
	get(id: number, ownerId: string): UserEvent | null;
	/** 持ち主の予定を、始まりの日の順に返す */
	listByOwner(ownerId: string): UserEvent[];
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
	};
}

export function createUserEventStore(database: Database): UserEventStore {
	const { db } = database;
	const owned = (id: number, ownerId: string) =>
		and(eq(userEvents.id, id), eq(userEvents.ownerId, ownerId));
	return {
		create(ownerId, input, now) {
			return db
				.insert(userEvents)
				.values({ ownerId, ...toColumns(input), createdAt: now, updatedAt: now })
				.returning({ id: userEvents.id })
				.get().id;
		},
		update(id, ownerId, input, now) {
			return (
				db
					.update(userEvents)
					.set({ ...toColumns(input), updatedAt: now })
					.where(owned(id, ownerId))
					.run().changes > 0
			);
		},
		delete(id, ownerId) {
			return db.delete(userEvents).where(owned(id, ownerId)).run().changes > 0;
		},
		get(id, ownerId) {
			const row = db.select().from(userEvents).where(owned(id, ownerId)).get();
			return row ? toEvent(row) : null;
		},
		listByOwner(ownerId) {
			return db
				.select()
				.from(userEvents)
				.where(eq(userEvents.ownerId, ownerId))
				.orderBy(asc(userEvents.startDate), asc(userEvents.id))
				.all()
				.map(toEvent);
		},
	};
}
