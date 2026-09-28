import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createAcademicCalendarStore,
	createAuthStore,
	createClassChangeStore,
	createCourseStore,
	createFeedTokenStore,
	createHolidayStore,
	createSubjectStore,
	openDatabase,
	type Database,
} from '@funmary/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadCalendarFeed, type CalendarFeedSources } from './calendar-feed.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-calendar-feed-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

// 2026-10-07 (水) の日本時間の朝
const NOW = new Date('2026-10-07T00:00:00+09:00');

function sources(): CalendarFeedSources {
	return {
		courses: createCourseStore(database),
		subjects: createSubjectStore(database),
		classChanges: createClassChangeStore(database),
		academicCalendar: createAcademicCalendarStore(database),
		holidays: createHolidayStore(database),
		estimateHolidays: () => [],
		feedTokens: createFeedTokenStore(database),
		origin: 'https://funmary.example.com',
	};
}

/** 後期の月曜 1 限の科目を履修した利用者を作り、カレンダーのトークンを発行する */
function setup() {
	const userId = createAuthStore(database).createUser(
		{ googleSub: 'a', email: 'a@fun.ac.jp', name: null, role: 'user' },
		NOW,
	);
	const subjectId = createSubjectStore(database).upsert(
		{
			academicYear: 2026,
			syllabusId: '100001',
			name: '代数学',
			term: 'fall',
			teacher: '未来 花子',
			credits: 2,
			attributes: {},
			syllabus: {},
			syllabusUrl: 'https://portal.example.com/Lesson/Syllabus?lesson_id=1&year=2026',
		},
		NOW,
	);
	const courses = createCourseStore(database);
	courses.register(userId, subjectId, NOW);
	courses.addSharedSlots(
		[{ subjectId, weekday: 1, period: 1, room: '363' }],
		{ source: 'manual', createdBy: userId },
		NOW,
	);
	const token = createFeedTokenStore(database).issue(userId, 'calendar', NOW);
	return { userId, subjectId, token };
}

describe('loadCalendarFeed', () => {
	it('トークンの持ち主の授業を、2 週間前から半年先まで、時刻と教員と URL を付けて返す', () => {
		const { subjectId, token } = setup();
		const loaded = loadCalendarFeed(sources(), token, NOW);
		if (!loaded) throw new Error('見つかるはず');
		const dates = loaded.feed.lessons.map((lesson) => lesson.date);
		expect(dates[0]).toBe('2026-09-28');
		expect(dates.every((date) => date >= '2026-09-23' && date <= '2027-04-07')).toBe(true);
		expect(loaded.feed.lessons[0]).toEqual({
			date: '2026-09-28',
			period: 1,
			start: '09:00',
			end: '10:30',
			subjectId,
			subjectName: '代数学',
			teacher: '未来 花子',
			room: '363',
			roomIsTentative: false,
			status: 'normal',
			detailUrl: `https://funmary.example.com/app/subjects/${subjectId}`,
			syllabusUrl: 'https://portal.example.com/Lesson/Syllabus?lesson_id=1&year=2026',
		});
		// 同じ日のうちは同じ内容になるよう、DTSTAMP は日本時間の今日の 0 時にする
		expect(loaded.stamp).toEqual(new Date('2026-10-07T00:00:00+09:00'));
	});

	it('振替授業日と全学の休講日を、終日の予定にする。祝日は載せない', () => {
		const { token } = setup();
		createHolidayStore(database).replaceAll('cabinetOffice', [
			{ date: '2026-10-12', name: 'スポーツの日' },
		]);
		const calendar = createAcademicCalendarStore(database);
		calendar.saveSubstituteDay({ date: '2026-10-14', weekday: 1 }, 'manual');
		calendar.saveNoClassDay('2026-10-15', '大学祭', 'manual');

		const loaded = loadCalendarFeed(sources(), token, NOW);
		expect(loaded?.feed.days).toEqual([
			{ date: '2026-10-14', summary: '振替授業日 (月曜の授業を行う日)' },
			{ date: '2026-10-15', summary: '全学の休講日 (大学祭)' },
		]);
	});

	it('知らないトークンなら null を返し、使ったときは使った日時を残す', () => {
		const { userId, token } = setup();
		expect(loadCalendarFeed(sources(), 'unknown', NOW)).toBeNull();
		expect(createFeedTokenStore(database).current(userId, 'calendar')?.lastUsedAt).toBeNull();
		loadCalendarFeed(sources(), token, NOW);
		expect(createFeedTokenStore(database).current(userId, 'calendar')?.lastUsedAt).toEqual(NOW);
	});

	it('https でないシラバスの URL は載せない', () => {
		const { token } = setup();
		const subjects = createSubjectStore(database);
		const subject = subjects.findBySyllabus(2026, '100001');
		if (!subject) throw new Error('あるはず');
		subjects.upsert({ ...subject, syllabusUrl: 'javascript:alert(1)' }, NOW);
		expect(loadCalendarFeed(sources(), token, NOW)?.feed.lessons[0]?.syllabusUrl).toBeNull();
	});
});
