// 利用者だけに見える、曜日と時限の書き換え (personal_timetable_slots)。
// 共有の枠 (timetable_slots) はほかの利用者と共有するが、これは本人にしか効かない。
// 「だれでも共有の枠を登録できる」設定を絞っていても、これは常に使える
import { and, eq } from 'drizzle-orm';
import type { Database } from './database.ts';
import { personalTimetableSlots } from './schema.ts';

export interface PersonalSlot {
	readonly weekday: number;
	readonly period: number;
	readonly room: string | null;
}

export interface PersonalSlotStore {
	/** 枠を足す、または教室を書き換える。同じ曜日と時限があれば上書きする */
	set(
		userId: string,
		subjectId: number,
		slot: { weekday: number; period: number; room: string | null },
		now: Date,
	): void;
	remove(userId: string, subjectId: number, weekday: number, period: number): boolean;
	listForSubject(userId: string, subjectId: number): PersonalSlot[];
}

export function createPersonalSlotStore(database: Database): PersonalSlotStore {
	const { db } = database;
	return {
		set(userId, subjectId, slot, now) {
			db.insert(personalTimetableSlots)
				.values({ userId, subjectId, ...slot, updatedAt: now })
				.onConflictDoUpdate({
					target: [
						personalTimetableSlots.userId,
						personalTimetableSlots.subjectId,
						personalTimetableSlots.weekday,
						personalTimetableSlots.period,
					],
					set: { room: slot.room, updatedAt: now },
				})
				.run();
		},
		remove(userId, subjectId, weekday, period) {
			return (
				db
					.delete(personalTimetableSlots)
					.where(
						and(
							eq(personalTimetableSlots.userId, userId),
							eq(personalTimetableSlots.subjectId, subjectId),
							eq(personalTimetableSlots.weekday, weekday),
							eq(personalTimetableSlots.period, period),
						),
					)
					.run().changes > 0
			);
		},
		listForSubject(userId, subjectId) {
			return db
				.select({
					weekday: personalTimetableSlots.weekday,
					period: personalTimetableSlots.period,
					room: personalTimetableSlots.room,
				})
				.from(personalTimetableSlots)
				.where(
					and(
						eq(personalTimetableSlots.userId, userId),
						eq(personalTimetableSlots.subjectId, subjectId),
					),
				)
				.all();
		},
	};
}
