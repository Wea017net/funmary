// 週の時間割 (設計書 12.1、12.4)。?date= で、その日を含む週を出す。省けば今週
import { redirect, type ServerLoad } from '@sveltejs/kit';
import {
	DEFAULT_PERIODS,
	addDays,
	eachDate,
	isoWeekday,
	jstDateTime,
	startOfWeek,
} from '@funmary/core';
import { parseDateParam } from '$lib/server/date-param.ts';
import { toLessonView, type LessonView } from '$lib/server/lesson-view.ts';
import { getServices } from '$lib/server/services.ts';
import { buildUserTimetable } from '$lib/server/user-timetable.ts';

export const load: ServerLoad = ({ locals, url }) => {
	if (!locals.user) redirect(303, '/login');
	const today = jstDateTime(new Date()).date;
	const param = url.searchParams.get('date');
	const date = parseDateParam(param);
	if (param !== null && date === null) redirect(303, '/week');

	const monday = startOfWeek(date ?? today);
	const range = { start: monday, end: addDays(monday, 6) };
	const timetable = buildUserTimetable(getServices(), locals.user.id, range);
	const lessons = timetable.lessons.map(toLessonView);

	// 月曜から金曜は必ず出し、土日は授業のある週だけ出す
	const days = [...eachDate(range.start, range.end)].filter(
		(day) => isoWeekday(day) <= 5 || lessons.some((lesson) => lesson.date === day),
	);
	const periods = [
		...new Set([
			...DEFAULT_PERIODS.map((period) => period.number),
			...lessons.map((lesson) => lesson.period),
		]),
	].sort((a, b) => a - b);
	const cells = new Map<string, LessonView[]>();
	for (const lesson of lessons) {
		const key = `${lesson.date}|${lesson.period}`;
		cells.set(key, [...(cells.get(key) ?? []), lesson]);
	}

	return {
		monday,
		previous: addDays(monday, -7),
		next: addDays(monday, 7),
		isThisWeek: monday === startOfWeek(today),
		today,
		days: days.map((day) => ({ date: day, note: timetable.notes.get(day) ?? null })),
		rows: periods.map((number) => {
			const period = DEFAULT_PERIODS.find((p) => p.number === number);
			return {
				period: number,
				start: period?.start ?? null,
				end: period?.end ?? null,
				cells: days.map((day) => ({ date: day, lessons: cells.get(`${day}|${number}`) ?? [] })),
			};
		}),
		hasLessons: lessons.length > 0,
		usesEstimatedTerms: timetable.usesEstimatedTerms,
	};
};
