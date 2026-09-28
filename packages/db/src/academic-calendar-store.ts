// 学期の期間と振替授業日の保存 (設計書 10 章)。値の出どころ (auto、manual) も一緒に残す。
// 推定した値は保存しない (@funmary/core の resolveAcademicTerms が、読むときに補う)。
import type {
	CalendarDate,
	StoredTerm,
	SubstituteDay,
	Term,
	TermPeriod,
	Weekday,
} from '@funmary/core';
import { and, between, eq, inArray } from 'drizzle-orm';
import type { Database } from './database.ts';
import { academicDays, academicTerms } from './schema.ts';

export type StoredSource = 'auto' | 'manual';

export interface AcademicCalendarStore {
	/** 年度の学期の期間 (推定は含まない) */
	listTerms(academicYear: number): StoredTerm[];
	/**
	 * 保存する。管理者が入れた値 (manual) は、自動で取った値 (auto) で上書きしない。
	 * 保存したら true、上書きを断ったら false
	 */
	saveTerm(academicYear: number, period: TermPeriod, source: StoredSource, now: Date): boolean;
	deleteTerm(academicYear: number, term: Term): void;
	/** start から end まで (両端を含む) の振替授業日 */
	listSubstituteDays(start: CalendarDate, end: CalendarDate): SubstituteDay[];
	saveSubstituteDay(day: SubstituteDay, source: StoredSource): void;
	deleteSubstituteDay(date: CalendarDate): void;
	/** start から end まで (両端を含む) の、全学の休講日。label は学年暦の行事名 */
	listNoClassDays(start: CalendarDate, end: CalendarDate): NoClassDay[];
	saveNoClassDay(date: CalendarDate, label: string | null, source: StoredSource): void;
	deleteNoClassDay(date: CalendarDate): void;
	/**
	 * 学年暦から取った日で、range (両端を含む) の中の自動 (auto) の振替授業日と休講日を入れ替える。
	 * 管理者が入れた日 (manual) は消さず、上書きもしない。上書きしなかった日付を返す
	 */
	replaceAutoDays(
		range: { readonly start: CalendarDate; readonly end: CalendarDate },
		days: {
			readonly substituteDays: readonly SubstituteDay[];
			readonly noClassDays: readonly NoClassDay[];
		},
	): { substituteDays: CalendarDate[]; noClassDays: CalendarDate[] };
}

export interface NoClassDay {
	readonly date: CalendarDate;
	readonly label: string | null;
}

export function createAcademicCalendarStore(database: Database): AcademicCalendarStore {
	const { db, sqlite } = database;
	return {
		listTerms(academicYear) {
			return db
				.select()
				.from(academicTerms)
				.where(eq(academicTerms.academicYear, academicYear))
				.orderBy(academicTerms.start)
				.all()
				.filter((row) => row.source !== 'estimated')
				.map((row) => ({
					term: row.term as Term,
					start: row.start,
					end: row.end,
					source: row.source as StoredSource,
				}));
		},
		saveTerm(academicYear, period, source, now) {
			const existing = db
				.select()
				.from(academicTerms)
				.where(
					and(eq(academicTerms.academicYear, academicYear), eq(academicTerms.term, period.term)),
				)
				.get();
			if (existing?.source === 'manual' && source === 'auto') return false;
			db.insert(academicTerms)
				.values({
					academicYear,
					term: period.term,
					start: period.start,
					end: period.end,
					source,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: [academicTerms.academicYear, academicTerms.term],
					set: { start: period.start, end: period.end, source, updatedAt: now },
				})
				.run();
			return true;
		},
		deleteTerm(academicYear, term) {
			db.delete(academicTerms)
				.where(and(eq(academicTerms.academicYear, academicYear), eq(academicTerms.term, term)))
				.run();
		},
		listSubstituteDays(start, end) {
			return db
				.select()
				.from(academicDays)
				.where(and(eq(academicDays.kind, 'substitute'), between(academicDays.date, start, end)))
				.orderBy(academicDays.date)
				.all()
				.flatMap((row) =>
					row.weekday === null ? [] : [{ date: row.date, weekday: row.weekday as Weekday }],
				);
		},
		saveSubstituteDay(day, source) {
			db.insert(academicDays)
				.values({ date: day.date, kind: 'substitute', weekday: day.weekday, source })
				.onConflictDoUpdate({
					target: [academicDays.date, academicDays.kind],
					set: { weekday: day.weekday, source },
				})
				.run();
		},
		deleteSubstituteDay(date) {
			db.delete(academicDays)
				.where(and(eq(academicDays.date, date), eq(academicDays.kind, 'substitute')))
				.run();
		},
		listNoClassDays(start, end) {
			return db
				.select({ date: academicDays.date, label: academicDays.label })
				.from(academicDays)
				.where(and(eq(academicDays.kind, 'noClass'), between(academicDays.date, start, end)))
				.orderBy(academicDays.date)
				.all();
		},
		saveNoClassDay(date, label, source) {
			db.insert(academicDays)
				.values({ date, kind: 'noClass', label, source })
				.onConflictDoUpdate({
					target: [academicDays.date, academicDays.kind],
					set: { label, source },
				})
				.run();
		},
		deleteNoClassDay(date) {
			db.delete(academicDays)
				.where(and(eq(academicDays.date, date), eq(academicDays.kind, 'noClass')))
				.run();
		},
		replaceAutoDays(range, days) {
			return sqlite.transaction(() => {
				const inRange = between(academicDays.date, range.start, range.end);
				db.delete(academicDays)
					.where(
						and(
							eq(academicDays.source, 'auto'),
							inArray(academicDays.kind, ['substitute', 'noClass']),
							inRange,
						),
					)
					.run();
				const manual = db
					.select({ date: academicDays.date, kind: academicDays.kind })
					.from(academicDays)
					.where(and(eq(academicDays.source, 'manual'), inRange))
					.all();
				const isManual = (date: CalendarDate, kind: 'substitute' | 'noClass') =>
					manual.some((row) => row.date === date && row.kind === kind);
				const skipped = { substituteDays: [] as CalendarDate[], noClassDays: [] as CalendarDate[] };
				for (const day of days.substituteDays) {
					if (isManual(day.date, 'substitute')) skipped.substituteDays.push(day.date);
					else {
						db.insert(academicDays)
							.values({ date: day.date, kind: 'substitute', weekday: day.weekday, source: 'auto' })
							.run();
					}
				}
				for (const day of days.noClassDays) {
					if (isManual(day.date, 'noClass')) skipped.noClassDays.push(day.date);
					else {
						db.insert(academicDays)
							.values({ date: day.date, kind: 'noClass', label: day.label, source: 'auto' })
							.run();
					}
				}
				return skipped;
			})();
		},
	};
}
