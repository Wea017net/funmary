// 時間割の画面 (/、/week) に渡す 1 回分の授業。表示に要るものだけにする。
import { DEFAULT_PERIODS, findPeriod } from '@funmary/core';
import { subjectPathParams, type SubjectPathParams } from '../subject-path.ts';
import type { TimetableLesson } from './user-timetable.ts';

export interface LessonView {
	readonly key: string;
	readonly date: string;
	readonly period: number;
	/** 時限の時刻。分からない時限なら null */
	readonly start: string | null;
	readonly end: string | null;
	readonly subjectId: number;
	readonly subjectName: string;
	/** 授業の詳細の URL の引数 */
	readonly subjectPath: SubjectPathParams;
	readonly room: string | null;
	readonly roomIsTentative: boolean;
	readonly status: TimetableLesson['status'];
}

export function toLessonView(lesson: TimetableLesson): LessonView {
	const period = findPeriod(lesson.period, DEFAULT_PERIODS);
	return {
		key: `${lesson.date}-${lesson.period}-${lesson.subjectId}`,
		date: lesson.date,
		period: lesson.period,
		start: period?.start ?? null,
		end: period?.end ?? null,
		subjectId: lesson.subjectId,
		subjectName: lesson.subjectName,
		subjectPath: subjectPathParams(lesson),
		room: lesson.room,
		roomIsTentative: lesson.roomIsTentative,
		status: lesson.status,
	};
}
