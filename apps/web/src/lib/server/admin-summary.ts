// 設定の画面の「管理」の節に出す、管理者が気にかけること (照合できなかった授業名の数、学年暦が推定のままか)。
import { academicYearOf, jstDateTime, resolveAcademicTerms } from '@funmary/core';
import type { Services } from './services.ts';

export interface AdminSummary {
	readonly unresolvedLessons: number;
	readonly calendarYear: number;
	/** 今の年度の前期と後期のうち、推定のままの数 */
	readonly estimatedTerms: number;
}

export function loadAdminSummary(
	services: Pick<Services, 'subjects' | 'unmatchedLessons' | 'academicCalendar'>,
	now: Date,
): AdminSummary {
	const { subjects, unmatchedLessons, academicCalendar } = services;
	const academicYear = subjects.latestYear();
	const calendarYear = academicYearOf(jstDateTime(now).date);
	const estimatedTerms = resolveAcademicTerms(
		calendarYear,
		academicCalendar.listTerms(calendarYear),
	)
		// クォーターは前期か後期に従うので、前期と後期だけを数える
		.filter(
			(term) => (term.term === 'spring' || term.term === 'fall') && term.source === 'estimated',
		).length;
	return {
		unresolvedLessons:
			academicYear === null ? 0 : unmatchedLessons.listUnresolved(academicYear).length,
		calendarYear,
		estimatedTerms,
	};
}
