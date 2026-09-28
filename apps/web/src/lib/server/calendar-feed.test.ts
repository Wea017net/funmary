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
	createUserEventStore,
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
		userEvents: createUserEventStore(database),
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
		const { token } = setup();
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
			subjectKey: '2026-100001',
			subjectName: '代数学',
			teacher: '未来 花子',
			room: '363',
			roomIsTentative: false,
			status: 'normal',
			// 授業の詳細の URL と予定の ID は、DB の ID でなく、年度とシラバスの番号で作る
			detailUrl: 'https://funmary.example.com/app/subjects/2026/100001',
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

	describe('利用者の予定', () => {
		const input = (
			overrides: Partial<Parameters<ReturnType<typeof createUserEventStore>['create']>[1]> = {},
		) => ({
			title: '架空のサークル',
			location: null,
			notes: null,
			startDate: '2026-11-02',
			endDate: '2026-11-02',
			time: { kind: 'time' as const, start: '17:00', end: '18:30' },
			rrule: null,
			excludedDates: [],
			visibility: 'private' as const,
			...overrides,
		});

		it('持ち主の予定を、繰り返しのまま、時刻や時限を時刻にして返す。ほかの人の予定は含めない', () => {
			const { userId, token } = setup();
			const other = createAuthStore(database).createUser(
				{ googleSub: 'b', email: 'b@fun.ac.jp', name: null, role: 'user' },
				NOW,
			);
			const events = createUserEventStore(database);
			const weekly = events.create(
				userId,
				input({ rrule: 'FREQ=WEEKLY;BYDAY=MO', excludedDates: ['2026-11-09'] }),
				NOW,
			);
			const period = events.create(
				userId,
				input({
					startDate: '2026-11-03',
					endDate: '2026-11-03',
					time: { kind: 'period', from: 2, to: 3 },
				}),
				NOW,
			);
			const allDay = events.create(
				userId,
				input({ startDate: '2026-11-05', endDate: '2026-11-07', time: { kind: 'allDay' } }),
				NOW,
			);
			events.create(other, input({ title: 'ほかの人の予定' }), NOW);

			const loaded = loadCalendarFeed(sources(), token, NOW);
			const byId = new Map((loaded?.feed.events ?? []).map((event) => [event.id, event]));
			expect(byId.size).toBe(3);
			expect(byId.get(weekly)).toMatchObject({
				allDay: false,
				start: '17:00',
				end: '18:30',
				rrule: 'FREQ=WEEKLY;BYDAY=MO',
				excludedDates: ['2026-11-09'],
				detailUrl: `https://funmary.example.com/app/events/${weekly}`,
			});
			expect(byId.get(period)).toMatchObject({ allDay: false, start: '10:40', end: '14:40' });
			expect(byId.get(allDay)).toMatchObject({ allDay: true, start: null, endDate: '2026-11-07' });
		});

		it('期間の外の単発の予定は含めず、期間より前に始まった繰り返しは含める', () => {
			const { userId, token } = setup();
			const events = createUserEventStore(database);
			events.create(userId, input({ startDate: '2025-01-05', endDate: '2025-01-05' }), NOW);
			events.create(userId, input({ startDate: '2028-01-05', endDate: '2028-01-05' }), NOW);
			const running = events.create(
				userId,
				input({ startDate: '2025-01-06', endDate: '2025-01-06', rrule: 'FREQ=WEEKLY' }),
				NOW,
			);
			const loaded = loadCalendarFeed(sources(), token, NOW);
			expect(loaded?.feed.events?.map((event) => event.id)).toEqual([running]);
		});
	});
});
