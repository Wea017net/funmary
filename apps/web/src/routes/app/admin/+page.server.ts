import type { ServerLoad } from '@sveltejs/kit';
import { academicYearOf, jstDateTime, resolveAcademicTerms } from '@funmary/core';
import { requireAdmin } from '$lib/server/admin.ts';
import { getServices } from '$lib/server/services.ts';

export const load: ServerLoad = ({ locals }) => {
	requireAdmin(locals);
	const { subjects, unmatchedLessons, academicCalendar } = getServices();
	const academicYear = subjects.latestYear();
	const calendarYear = academicYearOf(jstDateTime(new Date()).date);
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
};
