// 科目と照合できなかった授業名の記録 (設計書 11 章)。管理者が確かめて、手で科目に紐付ける。
// 同じ名前は年度ごとに 1 行にまとめ、最初に見た時刻と、最後に見た時刻を残す。
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Database } from './database.ts';
import { unmatchedLessons } from './schema.ts';

export interface UnmatchedLesson {
	readonly lessonName: string;
	readonly firstSeenAt: Date;
	readonly lastSeenAt: Date;
}

export interface UnmatchedLessonStore {
	/** 授業名を記録し、新しく記録した数を返す。既にあれば、最後に見た時刻だけ変える */
	record(academicYear: number, lessonNames: readonly string[], now: Date): number;
	/** まだ科目に紐付けていないものを、名前の順に返す */
	listUnresolved(academicYear: number): UnmatchedLesson[];
	/** 管理者が科目に紐付けた名前と、その科目の ID */
	resolvedNames(academicYear: number): Map<string, number>;
	/** 管理者が、授業名を科目に紐付ける。記録のない名前なら false */
	resolve(academicYear: number, lessonName: string, subjectId: number): boolean;
}

export function createUnmatchedLessonStore(database: Database): UnmatchedLessonStore {
	const { db, sqlite } = database;
	return {
		record(academicYear, lessonNames, now) {
			let added = 0;
			sqlite.transaction(() => {
				for (const lessonName of new Set(lessonNames)) {
					const inserted = db
						.insert(unmatchedLessons)
						.values({ academicYear, lessonName, firstSeenAt: now, lastSeenAt: now })
						.onConflictDoNothing()
						.run();
					if (inserted.changes > 0) {
						added++;
						continue;
					}
					db.update(unmatchedLessons)
						.set({ lastSeenAt: now })
						.where(
							and(
								eq(unmatchedLessons.academicYear, academicYear),
								eq(unmatchedLessons.lessonName, lessonName),
							),
						)
						.run();
				}
			})();
			return added;
		},

		listUnresolved(academicYear) {
			return db
				.select({
					lessonName: unmatchedLessons.lessonName,
					firstSeenAt: unmatchedLessons.firstSeenAt,
					lastSeenAt: unmatchedLessons.lastSeenAt,
				})
				.from(unmatchedLessons)
				.where(
					and(
						eq(unmatchedLessons.academicYear, academicYear),
						isNull(unmatchedLessons.resolvedSubjectId),
					),
				)
				.orderBy(asc(unmatchedLessons.lessonName))
				.all();
		},

		resolve(academicYear, lessonName, subjectId) {
			const updated = db
				.update(unmatchedLessons)
				.set({ resolvedSubjectId: subjectId })
				.where(
					and(
						eq(unmatchedLessons.academicYear, academicYear),
						eq(unmatchedLessons.lessonName, lessonName),
					),
				)
				.run();
			return updated.changes > 0;
		},

		resolvedNames(academicYear) {
			const rows = db
				.select({
					lessonName: unmatchedLessons.lessonName,
					subjectId: unmatchedLessons.resolvedSubjectId,
				})
				.from(unmatchedLessons)
				.where(
					and(
						eq(unmatchedLessons.academicYear, academicYear),
						isNotNull(unmatchedLessons.resolvedSubjectId),
					),
				)
				.all();
			return new Map(
				rows.flatMap((row) => (row.subjectId === null ? [] : [[row.lessonName, row.subjectId]])),
			);
		},
	};
}
