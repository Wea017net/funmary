// 今日の画面 (設計書 4.4、12.1)。次の授業の時刻と教室を大きく出し、今日の授業と休講などを並べる。
import { redirect, type ServerLoad } from '@sveltejs/kit';
import { DEFAULT_PERIODS, addDays, findNextLesson, isStale, jstDateTime } from '@funmary/core';
import { PORTAL_SOURCE } from '@funmary/jobs';
import { getServices } from '$lib/server/services.ts';
import { toLessonView } from '$lib/server/lesson-view.ts';
import { buildUserTimetable } from '$lib/server/user-timetable.ts';

/** 次の授業を探す日数。長い休みの間は見つからなくてよい */
const LOOKAHEAD_DAYS = 14;

export const load: ServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');

	const now = new Date();
	const current = jstDateTime(now);
	const services = getServices();
	const timetable = buildUserTimetable(services, locals.user.id, {
		start: current.date,
		end: addDays(current.date, LOOKAHEAD_DAYS - 1),
	});
	const next = findNextLesson(timetable.lessons, current, DEFAULT_PERIODS);
	const portal = services.sourceHealth.load(PORTAL_SOURCE);

	return {
		today: {
			date: current.date,
			note: timetable.notes.get(current.date) ?? null,
			lessons: timetable.lessons.filter((lesson) => lesson.date === current.date).map(toLessonView),
			next: next && { ...toLessonView(next.lesson), inProgress: next.inProgress },
			hasRegistrations: services.courses.listRegistrations(locals.user.id).length > 0,
			usesEstimatedTerms: timetable.usesEstimatedTerms,
			fetchedAt: portal.lastSuccessAt && jstDateTime(portal.lastSuccessAt),
			stale: isStale(portal.lastSuccessAt, now),
		},
	};
};
