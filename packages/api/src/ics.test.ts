import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import { buildIcs, type CalendarFeed, type CalendarLesson, type CalendarUserEvent } from './ics.ts';

const lesson = (overrides: Partial<CalendarLesson> = {}): CalendarLesson => ({
	date: '2026-10-05',
	period: 1,
	start: '09:00',
	end: '10:30',
	subjectKey: '2026-100201',
	subjectName: '情報処理演習',
	teacher: '未来 花子',
	room: '363',
	roomIsTentative: false,
	status: 'normal',
	detailUrl: 'https://funmary.example.com/app/subjects/2026/100201',
	syllabusUrl: 'https://portal.example.com/Lesson/Syllabus?lesson_id=1&year=2026',
	...overrides,
});

const options = { uidDomain: 'funmary.example.com', stamp: new Date('2026-10-01T00:00:00Z') };

function events(feed: CalendarFeed) {
	const calendar = new ICAL.Component(ICAL.parse(buildIcs(feed, options)) as unknown[]);
	return calendar.getAllSubcomponents('vevent').map((vevent) => ({
		vevent,
		event: new ICAL.Event(vevent),
	}));
}

describe('buildIcs', () => {
	it('授業を、日本時間の時限の時刻の予定にする。場所に教室、説明に教員と URL を入れる', () => {
		const [first] = events({ lessons: [lesson()], days: [] });
		expect(first?.event.summary).toBe('情報処理演習');
		expect(first?.event.location).toBe('363');
		expect(first?.event.startDate.toJSDate()).toEqual(new Date('2026-10-05T09:00:00+09:00'));
		expect(first?.event.endDate.toJSDate()).toEqual(new Date('2026-10-05T10:30:00+09:00'));
		expect(first?.event.description).toContain('教員: 未来 花子');
		expect(first?.event.description).toContain(
			'https://funmary.example.com/app/subjects/2026/100201',
		);
		expect(first?.event.description).toContain('lesson_id=1');
		expect(first?.event.uid).toBe('2026-10-05-1-2026-100201@funmary.example.com');
	});

	it('UID は日付、時限、科目から決まり、作り直しても変わらない', () => {
		const a = events({ lessons: [lesson()], days: [] });
		const b = events({ lessons: [lesson({ status: 'cancelled' })], days: [] });
		expect(a[0]?.event.uid).toBe(b[0]?.event.uid);
	});

	it('休講は予定を消さずに STATUS:CANCELLED と [休講] を付ける。補講と教室変更にも印を付ける', () => {
		const list = events({
			lessons: [
				lesson({ status: 'cancelled' }),
				lesson({ period: 2, start: '10:40', end: '12:10', status: 'makeup' }),
				lesson({ period: 3, start: '13:10', end: '14:40', status: 'roomChanged', room: '495' }),
			],
			days: [],
		});
		expect(list.map(({ event }) => event.summary)).toEqual([
			'[休講] 情報処理演習',
			'[補講] 情報処理演習',
			'[教室変更] 情報処理演習',
		]);
		expect(list[0]?.vevent.getFirstPropertyValue('status')).toBe('CANCELLED');
		expect(list[1]?.vevent.getFirstPropertyValue('status')).toBe('CONFIRMED');
		expect(list[2]?.event.location).toBe('495');
	});

	it('補講の教室が仮のときは、説明でそう伝える', () => {
		const [first] = events({
			lessons: [lesson({ status: 'makeup', roomIsTentative: true })],
			days: [],
		});
		expect(first?.event.description).toContain('ふだんの教室');
	});

	it('時刻の分からない時限の授業は、終日の予定にする', () => {
		const [first] = events({
			lessons: [lesson({ period: 7, start: null, end: null })],
			days: [],
		});
		expect(first?.event.startDate.isDate).toBe(true);
		expect(first?.event.startDate.toString()).toBe('2026-10-05');
		expect(first?.event.summary).toBe('情報処理演習 (7 限)');
	});

	it('振替授業日などの日の予定は、終日の予定にする', () => {
		const [first] = events({
			lessons: [],
			days: [{ date: '2026-10-14', summary: '振替授業日 (月曜の授業)' }],
		});
		expect(first?.event.summary).toBe('振替授業日 (月曜の授業)');
		expect(first?.event.startDate.isDate).toBe(true);
		expect(first?.event.startDate.toString()).toBe('2026-10-14');
		expect(first?.event.endDate.toString()).toBe('2026-10-15');
	});

	it('日本語の長い行は 75 オクテットで折り返し、改行やカンマをエスケープする', () => {
		const text = buildIcs(
			{
				lessons: [lesson({ subjectName: 'あ'.repeat(40), room: '363, 364' })],
				days: [],
			},
			options,
		);
		for (const line of text.split('\r\n')) {
			expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
		}
		expect(text).toContain('LOCATION:363\\, 364');
	});

	it('カレンダーの名前と、取りに来る間隔の目安を付ける', () => {
		const text = buildIcs({ lessons: [], days: [] }, options);
		expect(text).toContain('X-WR-CALNAME:Funmary の時間割\r\n');
		expect(text).toContain('\r\nREFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n');
	});

	it('同じ入力なら同じ内容になる (ETag で 304 を返せるように)', () => {
		const feed = { lessons: [lesson()], days: [] };
		expect(buildIcs(feed, options)).toBe(buildIcs(feed, options));
	});
});

describe('buildIcs: 利用者の予定', () => {
	const userEvent = (overrides: Partial<CalendarUserEvent> = {}): CalendarUserEvent => ({
		id: 7,
		title: '架空のサークル練習',
		location: '架空の部室',
		notes: '差し入れあり',
		startDate: '2026-11-02',
		endDate: '2026-11-02',
		allDay: false,
		start: '17:00',
		end: '18:30',
		rrule: null,
		excludedDates: [],
		detailUrl: 'https://funmary.example.com/app/events/7',
		...overrides,
	});
	const build = (event: CalendarUserEvent) =>
		buildIcs({ lessons: [], days: [], events: [event] }, options);

	it('時刻の予定は、日本時間 (TZID) で書き、VTIMEZONE を付ける。UID は予定の ID から決める', () => {
		const text = build(userEvent());
		expect(text).toContain('BEGIN:VTIMEZONE');
		expect(text).toContain('TZID:Asia/Tokyo');
		expect(text).toContain('DTSTART;TZID=Asia/Tokyo:20261102T170000');
		expect(text).toContain('DTEND;TZID=Asia/Tokyo:20261102T183000');
		expect(text).toContain('UID:user-event-7@funmary.example.com');
		expect(text).toContain('SUMMARY:架空のサークル練習');
		expect(text).toContain('LOCATION:架空の部室');
		const [first] = events({ lessons: [], days: [], events: [userEvent()] });
		expect(first?.event.startDate.toJSDate()).toEqual(new Date('2026-11-02T17:00:00+09:00'));
		expect(first?.event.description).toContain('差し入れあり');
		expect(first?.event.description).toContain('https://funmary.example.com/app/events/7');
	});

	it('授業だけの購読には、VTIMEZONE を付けない', () => {
		expect(buildIcs({ lessons: [lesson()], days: [] }, options)).not.toContain('VTIMEZONE');
	});

	it('終日の予定は、DATE で書く。数日にわたるときは、終わりの日の翌日を DTEND にする', () => {
		const text = build(userEvent({ allDay: true, start: null, end: null, endDate: '2026-11-04' }));
		expect(text).toContain('DTSTART;VALUE=DATE:20261102');
		expect(text).toContain('DTEND;VALUE=DATE:20261105');
		expect(text).not.toContain('VTIMEZONE');
	});

	it('繰り返しは RRULE のまま書き、除く日は EXDATE にする。日付形式の UNTIL は、時刻の予定では日本時間の終わりの日の UTC にする', () => {
		const text = build(
			userEvent({
				rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231',
				excludedDates: ['2026-11-04', '2026-11-09'],
			}),
		);
		expect(text).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T145959Z');
		expect(text).toContain('EXDATE;TZID=Asia/Tokyo:20261104T170000');
		expect(text).toContain('EXDATE;TZID=Asia/Tokyo:20261109T170000');
	});

	it('終日の繰り返しでは、UNTIL は日付のまま。EXDATE も DATE', () => {
		const text = build(
			userEvent({
				allDay: true,
				start: null,
				end: null,
				rrule: 'FREQ=WEEKLY;UNTIL=20261231',
				excludedDates: ['2026-11-09'],
			}),
		);
		expect(text).toContain('RRULE:FREQ=WEEKLY;UNTIL=20261231');
		expect(text).toContain('EXDATE;VALUE=DATE:20261109');
	});

	it('ical.js で読み戻すと、除く日を飛ばして、各回が展開できる', () => {
		const [first] = events({
			lessons: [],
			days: [],
			events: [userEvent({ rrule: 'FREQ=WEEKLY;COUNT=3', excludedDates: ['2026-11-09'] })],
		});
		expect(first?.event.isRecurring()).toBe(true);
		const days: string[] = [];
		const iterator = first!.event.iterator();
		for (let next = iterator.next(); next && days.length < 5; next = iterator.next()) {
			days.push(next.toString().slice(0, 10));
		}
		// COUNT は除く日も数えるので、11/2、(11/9 は除く)、11/16
		expect(days).toEqual(['2026-11-02', '2026-11-16']);
	});
});
