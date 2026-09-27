import type { CalendarDate } from './calendar-date.ts';
import { DEFAULT_PERIODS, findPeriod, type Period } from './periods.ts';
import type { Lesson } from './timetable.ts';

export interface NextLesson<T = Lesson> {
	readonly lesson: T;
	/** 始まっていて、まだ終わっていない */
	readonly inProgress: boolean;
}

/**
 * 今の時刻から見た、次の授業 (授業中なら、その授業)。休講の授業は飛ばす。
 * lessons は expandTimetable の結果のように、日付と時限の順に並んでいるものとする。
 * now は日本時間の日付と "HH:MM" の時刻
 */
export function findNextLesson<T extends Pick<Lesson, 'date' | 'period' | 'status'>>(
	lessons: readonly T[],
	now: { readonly date: CalendarDate; readonly time: string },
	periods: readonly Period[] = DEFAULT_PERIODS,
): NextLesson<T> | null {
	for (const lesson of lessons) {
		if (lesson.status === 'cancelled' || lesson.date < now.date) continue;
		if (lesson.date > now.date) return { lesson, inProgress: false };
		// 今日の授業は、時刻の分かるものだけを見る (終わったかどうかを決められないため)
		const period = findPeriod(lesson.period, periods);
		if (!period || period.end <= now.time) continue;
		return { lesson, inProgress: period.start <= now.time };
	}
	return null;
}
