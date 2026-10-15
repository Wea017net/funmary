import { describe, expect, it } from 'vitest';
import { findNextLesson } from './next-lesson.ts';
import type { Lesson } from './timetable.ts';

function lesson(overrides: Partial<Lesson>): Lesson {
	return {
		date: '2026-10-05',
		period: 1,
		subjectId: 'algebra',
		room: '484',
		roomIsTentative: false,
		status: 'normal',
		...overrides,
	};
}

const lessons = [
	lesson({ period: 1, subjectId: 'english' }),
	lesson({ period: 3, subjectId: 'algebra' }),
	lesson({ date: '2026-10-06', period: 2, subjectId: 'physics' }),
];

describe('findNextLesson', () => {
	it('始まる前の授業のうち、最も早いものを返す', () => {
		expect(findNextLesson(lessons, { date: '2026-10-05', time: '08:00' })).toEqual({
			lesson: lessons[0],
			inProgress: false,
		});
	});

	it('授業中なら、その授業を授業中として返す', () => {
		expect(findNextLesson(lessons, { date: '2026-10-05', time: '09:00' })).toEqual({
			lesson: lessons[0],
			inProgress: true,
		});
	});

	it('終わった授業は飛ばす', () => {
		expect(findNextLesson(lessons, { date: '2026-10-05', time: '10:30' })?.lesson).toBe(lessons[1]);
	});

	it('今日の授業が終われば、次の日以降の授業を返す', () => {
		expect(findNextLesson(lessons, { date: '2026-10-05', time: '15:00' })).toEqual({
			lesson: lessons[2],
			inProgress: false,
		});
	});

	it('休講の授業は飛ばす', () => {
		const withCancel = [lesson({ period: 1, status: 'cancelled' }), lessons[1]!];
		expect(findNextLesson(withCancel, { date: '2026-10-05', time: '08:00' })?.lesson).toBe(
			lessons[1],
		);
	});

	it('時刻の分からない時限の授業は、今日なら飛ばし、次の日以降なら返す', () => {
		const unknown = [lesson({ period: 9 }), lesson({ date: '2026-10-06', period: 9 })];
		expect(findNextLesson(unknown, { date: '2026-10-05', time: '08:00' })?.lesson).toBe(unknown[1]);
	});

	it('この先の授業がなければ null', () => {
		expect(findNextLesson(lessons, { date: '2026-10-07', time: '08:00' })).toBeNull();
		expect(findNextLesson([], { date: '2026-10-05', time: '08:00' })).toBeNull();
	});
});
