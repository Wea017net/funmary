// 科目と照合できなかった授業名の記録。管理者が確かめて、科目に紐付けるか、科目にしないかを決める。
// 同じ名前は年度ごとに 1 行にまとめ、最初に見た時刻と、最後に見た時刻を残す。
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Database } from './database.ts';
import { unmatchedLessons } from './schema.ts';

export interface UnmatchedLesson {
	readonly lessonName: string;
	readonly firstSeenAt: Date;
	readonly lastSeenAt: Date;
}

export interface ResolvedLesson extends UnmatchedLesson {
	readonly subjectId: number;
}

export interface UnmatchedLessonStore {
	/** 授業名を記録し、新しく記録した数を返す。既にあれば、最後に見た時刻だけ変える */
	record(academicYear: number, lessonNames: readonly string[], now: Date): number;
	/** まだ科目に紐付けていなくて、科目にしないとも決めていないものを、名前の順に返す */
	listUnresolved(academicYear: number): UnmatchedLesson[];
	/** 科目に紐付けたものを、名前の順に返す */
	listResolved(academicYear: number): ResolvedLesson[];
	/** 科目にしないと決めたものを、名前の順に返す */
	listIgnored(academicYear: number): UnmatchedLesson[];
	/** 管理者が科目に紐付けた名前と、その科目の ID */
	resolvedNames(academicYear: number): Map<string, number>;
	/** 管理者が、授業名を科目に紐付ける。科目にしない決定は解く。記録のない名前なら false */
	resolve(academicYear: number, lessonName: string, subjectId: number): boolean;
	/** 紐付けを外し、未解決に戻す。記録のない名前なら false */
	unresolve(academicYear: number, lessonName: string): boolean;
	/** 科目にしないと決める。紐付けていれば外す。記録のない名前なら false */
	ignore(academicYear: number, lessonName: string, now: Date): boolean;
	/** 科目にしない決定を解き、未解決に戻す。記録のない名前なら false */
	restore(academicYear: number, lessonName: string): boolean;
}

export function createUnmatchedLessonStore(database: Database): UnmatchedLessonStore {
	const { db, sqlite } = database;
	const named = (academicYear: number, lessonName: string) =>
		and(
			eq(unmatchedLessons.academicYear, academicYear),
			eq(unmatchedLessons.lessonName, lessonName),
		);
	const listWhere = (condition: ReturnType<typeof and>) =>
		db
			.select({
				lessonName: unmatchedLessons.lessonName,
				firstSeenAt: unmatchedLessons.firstSeenAt,
				lastSeenAt: unmatchedLessons.lastSeenAt,
				subjectId: unmatchedLessons.resolvedSubjectId,
			})
			.from(unmatchedLessons)
			.where(condition)
			.orderBy(asc(unmatchedLessons.lessonName))
			.all();
	const withoutSubject = (row: ReturnType<typeof listWhere>[number]): UnmatchedLesson => ({
		lessonName: row.lessonName,
		firstSeenAt: row.firstSeenAt,
		lastSeenAt: row.lastSeenAt,
	});

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
						.where(named(academicYear, lessonName))
						.run();
				}
			})();
			return added;
		},

		listUnresolved(academicYear) {
			return listWhere(
				and(
					eq(unmatchedLessons.academicYear, academicYear),
					isNull(unmatchedLessons.resolvedSubjectId),
					isNull(unmatchedLessons.ignoredAt),
				),
			).map(withoutSubject);
		},

		listResolved(academicYear) {
			return listWhere(
				and(
					eq(unmatchedLessons.academicYear, academicYear),
					isNotNull(unmatchedLessons.resolvedSubjectId),
				),
			).flatMap(({ subjectId, ...rest }) => (subjectId === null ? [] : [{ ...rest, subjectId }]));
		},

		listIgnored(academicYear) {
			return listWhere(
				and(eq(unmatchedLessons.academicYear, academicYear), isNotNull(unmatchedLessons.ignoredAt)),
			).map(withoutSubject);
		},

		resolve(academicYear, lessonName, subjectId) {
			return (
				db
					.update(unmatchedLessons)
					.set({ resolvedSubjectId: subjectId, ignoredAt: null })
					.where(named(academicYear, lessonName))
					.run().changes > 0
			);
		},

		unresolve(academicYear, lessonName) {
			return (
				db
					.update(unmatchedLessons)
					.set({ resolvedSubjectId: null })
					.where(named(academicYear, lessonName))
					.run().changes > 0
			);
		},

		ignore(academicYear, lessonName, now) {
			return (
				db
					.update(unmatchedLessons)
					.set({ resolvedSubjectId: null, ignoredAt: now })
					.where(named(academicYear, lessonName))
					.run().changes > 0
			);
		},

		restore(academicYear, lessonName) {
			return (
				db
					.update(unmatchedLessons)
					.set({ ignoredAt: null })
					.where(named(academicYear, lessonName))
					.run().changes > 0
			);
		},

		resolvedNames(academicYear) {
			return new Map(
				this.listResolved(academicYear).map((row) => [row.lessonName, row.subjectId] as const),
			);
		},
	};
}
