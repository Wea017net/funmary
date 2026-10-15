// 共有の枠を「モデレーターが確認してから登録する」設定のときに使う、確認待ちの提出 (slot_submissions)。
// 承認すると、courses.addSharedSlots で timetable_slots に入る。この記録自体は結果を残すため消さない
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from './database.ts';
import { slotSubmissions, subjects, users } from './schema.ts';

export type SlotSubmissionStatus = 'pending' | 'approved' | 'rejected';

export interface SlotSubmission {
	readonly id: number;
	readonly subjectId: number;
	readonly subjectName: string;
	readonly weekday: number;
	readonly period: number;
	readonly room: string | null;
	readonly submittedByEmail: string | null;
	readonly submittedAt: Date;
	readonly status: SlotSubmissionStatus;
}

export interface SlotSubmissionStore {
	/** 提出を 1 件足し、その ID を返す */
	submit(
		input: { subjectId: number; weekday: number; period: number; room: string | null },
		submittedBy: string | null,
		now: Date,
	): number;
	/** 確認待ちのものを、古い順に返す */
	listPending(): SlotSubmission[];
	/** 承認、または却下する。既に決めたものや、無いものには false を返す */
	decide(id: number, status: 'approved' | 'rejected', decidedBy: string, now: Date): boolean;
	/** 承認待ちの、その提出そのもの (承認して共有の枠に入れるときに使う) */
	find(
		id: number,
	): { subjectId: number; weekday: number; period: number; room: string | null } | null;
}

export function createSlotSubmissionStore(database: Database): SlotSubmissionStore {
	const { db } = database;
	return {
		submit({ subjectId, weekday, period, room }, submittedBy, now) {
			return db
				.insert(slotSubmissions)
				.values({ subjectId, weekday, period, room, submittedBy, submittedAt: now })
				.returning({ id: slotSubmissions.id })
				.get().id;
		},
		listPending() {
			return db
				.select({
					id: slotSubmissions.id,
					subjectId: slotSubmissions.subjectId,
					subjectName: subjects.name,
					weekday: slotSubmissions.weekday,
					period: slotSubmissions.period,
					room: slotSubmissions.room,
					submittedByEmail: users.email,
					submittedAt: slotSubmissions.submittedAt,
					status: slotSubmissions.status,
				})
				.from(slotSubmissions)
				.innerJoin(subjects, eq(subjects.id, slotSubmissions.subjectId))
				.leftJoin(users, eq(users.id, slotSubmissions.submittedBy))
				.where(eq(slotSubmissions.status, 'pending'))
				.orderBy(desc(slotSubmissions.submittedAt))
				.all();
		},
		decide(id, status, decidedBy, now) {
			return (
				db
					.update(slotSubmissions)
					.set({ status, decidedBy, decidedAt: now })
					.where(and(eq(slotSubmissions.id, id), eq(slotSubmissions.status, 'pending')))
					.run().changes > 0
			);
		},
		find(id) {
			const row = db
				.select({
					subjectId: slotSubmissions.subjectId,
					weekday: slotSubmissions.weekday,
					period: slotSubmissions.period,
					room: slotSubmissions.room,
				})
				.from(slotSubmissions)
				.where(eq(slotSubmissions.id, id))
				.get();
			return row ?? null;
		},
	};
}
