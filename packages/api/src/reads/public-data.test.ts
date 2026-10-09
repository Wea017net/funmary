import {
	createAcademicCalendarStore,
	createAuthStore,
	createClassChangeStore,
	createCourseStore,
	createHolidayStore,
	createPersonalSlotStore,
	createSubjectStore,
	type Database,
} from '@funmary/db';
import { describe, expect, it } from 'vitest';
import {
	currentAcademicYear,
	getAcademicCalendar,
	getNextLesson,
	getPublicTimetable,
	listPeriods,
	listUserCourses,
} from './public-data.ts';
import type { TimetableSources } from './user-timetable.ts';
import { useTestDatabase } from '@funmary/db/testing';

let database: Database;
useTestDatabase('funmary-public-data-', (db) => (database = db));

const NOW = new Date('2026-09-27T00:00:00Z');

function sources(): TimetableSources {
	return {
		courses: createCourseStore(database),
		personalSlots: createPersonalSlotStore(database),
		subjects: createSubjectStore(database),
		classChanges: createClassChangeStore(database),
		academicCalendar: createAcademicCalendarStore(database),
		holidays: createHolidayStore(database),
		estimateHolidays: () => [],
	};
}

/** 利用者と、月曜 3 限と水曜 1 限に授業がある後期の科目を 1 つ用意する */
function setup() {
	const userId = createAuthStore(database).createUser(
		{ googleSub: 'a', email: 'a@fun.ac.jp', name: null, role: 'user' },
		NOW,
	);
	const subjectId = createSubjectStore(database).upsert(
		{
			academicYear: 2026,
			syllabusId: '100001',
			name: '架空の代数',
			teacher: '架空 太郎',
			credits: 2,
			term: 'fall',
			attributes: {},
			syllabus: {},
			syllabusUrl: null,
		},
		NOW,
	);
	const courses = createCourseStore(database);
	courses.register(userId, subjectId, NOW);
	courses.addSharedSlots(
		[
			{ subjectId, weekday: 1, period: 3, room: '484' },
			{ subjectId, weekday: 3, period: 1, room: null },
		],
		{ source: 'manual', createdBy: userId },
		NOW,
	);
	return { userId, subjectId };
}

describe('listPeriods', () => {
	it('時限の時刻を、1 限から順に返す', () => {
		expect(listPeriods()[0]).toEqual({ number: 1, start: '09:00', end: '10:30' });
		expect(listPeriods().map((period) => period.number)).toEqual([1, 2, 3, 4, 5, 6]);
	});
});

describe('getPublicTimetable', () => {
	it('授業に開始と終了の時刻を付け、振替授業日、全学の休講日、祝日を日付の順に返す', () => {
		const { userId } = setup();
		createHolidayStore(database).replaceAll('cabinetOffice', [
			{ date: '2026-10-12', name: 'スポーツの日' },
		]);
		const calendar = createAcademicCalendarStore(database);
		calendar.saveSubstituteDay({ date: '2026-10-16', weekday: 1 }, 'manual');
		calendar.saveNoClassDay('2026-10-14', '大学祭', 'manual');

		const timetable = getPublicTimetable(sources(), userId, {
			start: '2026-10-12',
			end: '2026-10-18',
		});

		expect(timetable.days).toEqual([
			{ date: '2026-10-12', kind: 'holiday', name: 'スポーツの日' },
			{ date: '2026-10-14', kind: 'noClass', label: '大学祭' },
			{ date: '2026-10-16', kind: 'substitute', weekday: 1 },
		]);
		// 10-12 (月) は祝日、10-14 (水) は休講日で、授業がない。10-16 (金) は月曜の授業を行う
		expect(timetable.lessons).toMatchObject([
			{
				date: '2026-10-16',
				period: 3,
				room: '484',
				start: '13:10',
				end: '14:40',
				status: 'normal',
			},
		]);
	});

	it('時限の時刻が分からない授業は、時刻が null になる', () => {
		const { userId, subjectId } = setup();
		createCourseStore(database).addSharedSlots(
			[{ subjectId, weekday: 5, period: 9, room: null }],
			{ source: 'manual', createdBy: userId },
			NOW,
		);

		const timetable = getPublicTimetable(sources(), userId, {
			start: '2026-10-16',
			end: '2026-10-16',
		});

		expect(timetable.lessons).toMatchObject([{ period: 9, start: null, end: null }]);
	});
});

describe('getNextLesson', () => {
	it('授業の時刻より前なら、その授業を、まだ始まっていないものとして返す', () => {
		const { userId } = setup();

		// 2026-10-05 (月) の日本時間 12:00
		const { next } = getNextLesson(sources(), userId, new Date('2026-10-05T03:00:00Z'));

		expect(next).toMatchObject({
			date: '2026-10-05',
			period: 3,
			start: '13:10',
			inProgress: false,
		});
	});

	it('授業中なら、その授業を inProgress で返す', () => {
		const { userId } = setup();

		const { next } = getNextLesson(sources(), userId, new Date('2026-10-05T04:30:00Z'));

		expect(next).toMatchObject({ date: '2026-10-05', period: 3, inProgress: true });
	});

	it('今日の授業が終わっていたら、次の日以降の授業を返す', () => {
		const { userId } = setup();

		const { next } = getNextLesson(sources(), userId, new Date('2026-10-05T08:00:00Z'));

		expect(next).toMatchObject({ date: '2026-10-07', period: 1, inProgress: false });
	});

	it('14 日以内に授業がなければ null', () => {
		const { userId } = setup();

		expect(getNextLesson(sources(), userId, new Date('2027-02-01T00:00:00Z'))).toEqual({
			next: null,
		});
	});
});

describe('listUserCourses', () => {
	it('履修科目の情報と、共有の曜日と時限を返す', () => {
		const { userId, subjectId } = setup();

		const courses = listUserCourses(sources(), userId);

		expect(courses).toHaveLength(1);
		expect(courses[0]).toMatchObject({
			subjectId,
			academicYear: 2026,
			syllabusId: '100001',
			name: '架空の代数',
			teacher: '架空 太郎',
			credits: 2,
			term: 'fall',
		});
		expect(courses[0]?.slots).toHaveLength(2);
		expect(courses[0]?.slots).toContainEqual({ weekday: 1, period: 3, room: '484' });
		expect(courses[0]?.slots).toContainEqual({ weekday: 3, period: 1, room: null });
	});

	it('履修登録がなければ空', () => {
		const userId = createAuthStore(database).createUser(
			{ googleSub: 'b', email: 'b@fun.ac.jp', name: null, role: 'user' },
			NOW,
		);

		expect(listUserCourses(sources(), userId)).toEqual([]);
	});
});

describe('getAcademicCalendar', () => {
	it('年度の学期の期間と、その年度の祝日、全学の休講日、振替授業日を返す', () => {
		createHolidayStore(database).replaceAll('cabinetOffice', [
			{ date: '2026-10-12', name: 'スポーツの日' },
			{ date: '2027-01-01', name: '元日' },
			{ date: '2027-04-29', name: '昭和の日' },
		]);
		const calendar = createAcademicCalendarStore(database);
		calendar.saveNoClassDay('2026-10-14', '大学祭', 'manual');
		calendar.saveSubstituteDay({ date: '2026-10-16', weekday: 1 }, 'manual');
		calendar.saveTerm(
			2026,
			{ term: 'fall', start: '2026-09-24', end: '2027-02-05' },
			'manual',
			NOW,
		);

		const result = getAcademicCalendar(sources(), 2026);

		expect(result.academicYear).toBe(2026);
		expect(result.terms.find((term) => term.term === 'fall')).toEqual({
			term: 'fall',
			start: '2026-09-24',
			end: '2027-02-05',
			source: 'manual',
		});
		// 年度 (4 月から翌年 3 月) の外の祝日は含めない
		expect(result.days).toEqual([
			{ date: '2026-10-12', kind: 'holiday', name: 'スポーツの日' },
			{ date: '2026-10-14', kind: 'noClass', label: '大学祭' },
			{ date: '2026-10-16', kind: 'substitute', weekday: 1 },
			{ date: '2027-01-01', kind: 'holiday', name: '元日' },
		]);
	});

	it('今日が属する年度は、4 月に替わる', () => {
		expect(currentAcademicYear(new Date('2027-03-31T00:00:00Z'))).toBe(2026);
		expect(currentAcademicYear(new Date('2027-04-01T00:00:00Z'))).toBe(2027);
	});
});
