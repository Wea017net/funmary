import type { ServerLoad } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin.ts';
import { getServices } from '$lib/server/services.ts';

export const load: ServerLoad = ({ locals }) => {
	requireAdmin(locals);
	const { subjects, unmatchedLessons } = getServices();
	const academicYear = subjects.latestYear();
	return {
		unresolvedLessons:
			academicYear === null ? 0 : unmatchedLessons.listUnresolved(academicYear).length,
	};
};
