import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectChanges } from '@funmary/core';
import {
	createAcademicCalendarStore,
	createAuthStore,
	createClassChangeStore,
	createCourseStore,
	createHolidayStore,
	createPersonalSlotStore,
	createSubjectStore,
	openDatabase,
	type Database,
} from '@funmary/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildUserTimetable, type TimetableSources } from './user-timetable.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-user-timetable-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date('2026-09-27T00:00:00Z');

function sources(estimate: TimetableSources['estimateHolidays'] = () => []): TimetableSources {
	return {
		courses: createCourseStore(database),
		personalSlots: createPersonalSlotStore(database),
		subjects: createSubjectStore(database),
		classChanges: createClassChangeStore(database),
		academicCalendar: createAcademicCalendarStore(database),
		holidays: createHolidayStore(database),
		estimateHolidays: estimate,
	};
}

function createUser(): string {
	return createAuthStore(database).createUser(
		{ googleSub: 'a', email: 'a@fun.ac.jp', name: null, role: 'user' },
		NOW,
	);
}

/** 科目を足して履修登録し、曜日と時限の枠を付ける */
function register(
	userId: string,
	subject: { academicYear: number; syllabusId: string; name: string; term: string },
	slots: { weekday: number; period: number; room: string | null }[],
): number {
	const subjectId = createSubjectStore(database).upsert(
		{ ...subject, teacher: null, credits: 2, attributes: {}, syllabus: {}, syllabusUrl: null },
		NOW,
	);
	const courses = createCourseStore(database);
	courses.register(userId, subjectId, NOW);
	courses.addSharedSlots(
		slots.map((slot) => ({ subjectId, ...slot })),
		{ source: 'manual', createdBy: userId },
		NOW,
	);
	return subjectId;
}

describe('buildUserTimetable', () => {
	it('祝日、振替授業日、全学の休講日、休講を反映して、科目名を付ける', () => {
		const userId = createUser();
		const algebra = register(
			userId,
			{ academicYear: 2026, syllabusId: '100001', name: '架空の代数', term: 'fall' },
			[{ weekday: 1, period: 3, room: '484' }],
		);
		const english = register(
			userId,
			{ academicYear: 2026, syllabusId: '100002', name: '架空の英語', term: 'fall' },
			[
				{ weekday: 2, period: 1, room: '363' },
				{ weekday: 4, period: 1, room: '363' },
			],
		);
		// 2026-10-12 (月) はスポーツの日。10-14 (水) に月曜の授業を行い、10-15 (木) は全学の休講日とする
		createHolidayStore(database).replaceAll('cabinetOffice', [
			{ date: '2026-10-12', name: 'スポーツの日' },
		]);
		const calendar = createAcademicCalendarStore(database);
		calendar.saveSubstituteDay({ date: '2026-10-14', weekday: 1 }, 'manual');
		calendar.saveNoClassDay('2026-10-15', '大学祭', 'manual');
		const changes = createClassChangeStore(database);
		const detected = detectChanges({
			previous: [],
			scraped: [
				{
					kind: 'cancellation',
					date: '2026-10-13',
					period: 1,
					lessonName: '架空の英語',
					teacher: null,
					campus: null,
					room: null,
					fromRoom: null,
					comment: null,
					makeupPlan: null,
				},
			],
			today: '2026-10-01',
		});
		if (detected.kind !== 'ok') throw new Error('ok のはず');
		changes.apply(detected.next, NOW);
		changes.assignSubject('架空の英語', english);

		const timetable = buildUserTimetable(sources(), userId, {
			start: '2026-10-12',
			end: '2026-10-18',
		});

		expect(timetable.lessons).toEqual([
			{
				date: '2026-10-13',
				period: 1,
				subjectId: english,
				subjectName: '架空の英語',
				academicYear: 2026,
				syllabusId: '100002',
				room: '363',
				roomIsTentative: false,
				status: 'cancelled',
			},
			{
				date: '2026-10-14',
				period: 3,
				subjectId: algebra,
				subjectName: '架空の代数',
				academicYear: 2026,
				syllabusId: '100001',
				room: '484',
				roomIsTentative: false,
				status: 'normal',
			},
		]);
		expect([...timetable.notes]).toEqual([
			['2026-10-12', { kind: 'holiday', name: 'スポーツの日' }],
			['2026-10-15', { kind: 'noClass', label: '大学祭' }],
			['2026-10-14', { kind: 'substitute', weekday: 1 }],
		]);
		// 学期の期間を入れていないので、推定を使う
		expect(timetable.usesEstimatedTerms).toBe(true);
	});

	it('年度をまたぐ期間は、年度ごとの科目と学期で展開する', () => {
		const userId = createUser();
		register(
			userId,
			{ academicYear: 2026, syllabusId: '100001', name: '去年の科目', term: 'fall' },
			[{ weekday: 1, period: 1, room: null }],
		);
		register(
			userId,
			{ academicYear: 2027, syllabusId: '100001', name: '今年の科目', term: 'spring' },
			[{ weekday: 1, period: 2, room: null }],
		);
		createAcademicCalendarStore(database).saveTerm(
			2027,
			{ term: 'spring', start: '2027-04-05', end: '2027-07-23' },
			'manual',
			NOW,
		);

		const timetable = buildUserTimetable(sources(), userId, {
			start: '2027-03-29',
			end: '2027-04-11',
		});

		expect(timetable.lessons.map((lesson) => [lesson.date, lesson.subjectName])).toEqual([
			['2027-04-05', '今年の科目'],
		]);
		// 2026 年度の後期は推定だが、期間には掛からない
		expect(timetable.usesEstimatedTerms).toBe(false);
	});

	it('保存された祝日より先の年は、推定の祝日を使う', () => {
		const userId = createUser();
		register(
			userId,
			{ academicYear: 2027, syllabusId: '100001', name: '架空の科目', term: 'spring' },
			[{ weekday: 4, period: 1, room: null }],
		);
		createHolidayStore(database).replaceAll('cabinetOffice', [
			{ date: '2026-11-03', name: '文化の日' },
		]);

		const timetable = buildUserTimetable(
			sources((year) => (year === 2027 ? [{ date: '2027-04-29', name: '昭和の日' }] : [])),
			userId,
			{ start: '2027-04-26', end: '2027-05-02' },
		);

		expect(timetable.lessons).toEqual([]);
		expect(timetable.notes.get('2027-04-29')).toEqual({ kind: 'holiday', name: '昭和の日' });
	});

	it('履修科目がなければ、授業はない', () => {
		const userId = createUser();
		const timetable = buildUserTimetable(sources(), userId, {
			start: '2026-10-12',
			end: '2026-10-18',
		});
		expect(timetable.lessons).toEqual([]);
		expect(timetable.usesEstimatedTerms).toBe(false);
	});
});
