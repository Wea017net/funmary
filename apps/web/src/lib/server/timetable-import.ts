// 授業時間割の PDF の読み取り結果を、科目と照合して、科目ごとに共有する枠に取り込む (管理用コマンドの timetable import)。
// 既定では確かめるだけで、apply のときだけ書き込む。既にある枠は上書きせず、教室の食い違いは返して管理者が確かめる。
import {
	planSlotImport,
	subjectsInSemester,
	type PlannedSlot,
	type UnmatchedName,
} from '@funmary/core';
import type { CourseStore, SlotConflict, SubjectStore, UnmatchedLessonStore } from '@funmary/db';
import type { TimetablePdfResult } from '@funmary/sources';

export type ParsedTimetable = Extract<TimetablePdfResult, { kind: 'ok' }>;

export interface TimetableImportDeps {
	readonly subjects: SubjectStore;
	readonly courses: CourseStore;
	readonly unmatched: UnmatchedLessonStore;
}

export interface TimetableImportOptions {
	readonly apply: boolean;
	readonly now: Date;
	/** PDF の表題の年度の代わりに使う年度 */
	readonly academicYear?: number;
	/** 読み取りの警告があっても書き込む */
	readonly ignoreWarnings?: boolean;
}

export type TimetableImportReport =
	| { readonly kind: 'no-year' }
	| { readonly kind: 'no-subjects'; readonly academicYear: number }
	| { readonly kind: 'has-warnings'; readonly warnings: readonly string[] }
	| {
			readonly kind: 'planned';
			readonly academicYear: number;
			readonly term: ParsedTimetable['term'];
			readonly warnings: readonly string[];
			readonly slots: readonly PlannedSlot[];
			readonly unmatched: readonly UnmatchedName[];
			/** 書き込んだ結果。確かめるだけなら null */
			readonly applied: {
				readonly added: number;
				readonly updated: number;
				readonly conflicts: readonly SlotConflict[];
				/** 新しく記録した、照合できなかった名前の数 */
				readonly newUnmatched: number;
			} | null;
	  };

export function importTimetable(
	parsed: ParsedTimetable,
	deps: TimetableImportDeps,
	options: TimetableImportOptions,
): TimetableImportReport {
	const academicYear = options.academicYear ?? parsed.academicYear;
	if (academicYear === null) return { kind: 'no-year' };
	if (options.apply && parsed.warnings.length > 0 && !options.ignoreWarnings) {
		return { kind: 'has-warnings', warnings: parsed.warnings };
	}

	const subjects = deps.subjects.list(academicYear);
	if (subjects.length === 0) return { kind: 'no-subjects', academicYear };

	const plan = planSlotImport(
		parsed.entries,
		subjectsInSemester(subjects, parsed.term),
		// 管理者が管理画面で紐付けた名前は、照合より優先する
		deps.unmatched.resolvedNames(academicYear),
	);
	let applied = null;
	if (options.apply) {
		const result = deps.courses.addSharedSlots(
			plan.slots,
			{ source: 'pdf', createdBy: null },
			options.now,
		);
		const newUnmatched = deps.unmatched.record(
			academicYear,
			plan.unmatched.map((u) => u.lessonName),
			options.now,
		);
		applied = { ...result, newUnmatched };
	}
	return {
		kind: 'planned',
		academicYear,
		term: parsed.term,
		warnings: parsed.warnings,
		slots: plan.slots,
		unmatched: plan.unmatched,
		applied,
	};
}
