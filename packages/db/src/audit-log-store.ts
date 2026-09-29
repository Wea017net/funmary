// 利用者が全体に影響する操作をしたときの記録 (audit_log_entries)。
// シラバスにない授業の公開、情報の変更、削除、授業名の紐づけなど、ほかの利用者にも見える変更が対象。
// 記録は消せない (管理画面にも削除の口を作らない)。行った人が退会しても、summary の文だけ残す
import { desc, eq } from 'drizzle-orm';
import type { Database } from './database.ts';
import { auditLogEntries, subjects, users } from './schema.ts';

/** 操作の種類。画面には出さず、絞り込みなどに使う */
export type AuditAction =
	| 'subject.create'
	| 'subject.update'
	| 'subject.delete'
	| 'subject.visibility'
	| 'lesson.resolve'
	| 'lesson.unresolve'
	| 'lesson.ignore'
	| 'lesson.restore'
	| 'slot.approve';

export interface AuditLogEntry {
	readonly id: number;
	readonly actorEmail: string | null;
	readonly action: AuditAction;
	readonly subjectId: number | null;
	/** 関わった科目が、まだ残っていれば (消えていれば null) */
	readonly subject: { readonly academicYear: number; readonly syllabusId: string } | null;
	readonly summary: string;
	readonly createdAt: Date;
}

export interface AuditLogStore {
	/** 記録を 1 件足す。actorId は退会などで null になりうる */
	record(
		entry: {
			readonly actorId: string | null;
			readonly action: AuditAction;
			readonly subjectId?: number | null;
			readonly summary: string;
		},
		now: Date,
	): void;
	/** 新しい順に count 件 (管理画面に使う) */
	recent(count: number): AuditLogEntry[];
}

export function createAuditLogStore(database: Database): AuditLogStore {
	const { db } = database;
	return {
		record({ actorId, action, subjectId, summary }, now) {
			db.insert(auditLogEntries)
				.values({ actorId, action, subjectId: subjectId ?? null, summary, createdAt: now })
				.run();
		},
		recent(count) {
			return db
				.select({
					id: auditLogEntries.id,
					actorEmail: users.email,
					action: auditLogEntries.action,
					subjectId: auditLogEntries.subjectId,
					academicYear: subjects.academicYear,
					syllabusId: subjects.syllabusId,
					summary: auditLogEntries.summary,
					createdAt: auditLogEntries.createdAt,
				})
				.from(auditLogEntries)
				.leftJoin(users, eq(users.id, auditLogEntries.actorId))
				.leftJoin(subjects, eq(subjects.id, auditLogEntries.subjectId))
				.orderBy(desc(auditLogEntries.createdAt), desc(auditLogEntries.id))
				.limit(count)
				.all()
				.map(({ academicYear, syllabusId, ...row }) => ({
					...row,
					subject:
						academicYear !== null && syllabusId !== null ? { academicYear, syllabusId } : null,
				})) as AuditLogEntry[];
		},
	};
}
