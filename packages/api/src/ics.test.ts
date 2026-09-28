import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import { buildIcs, type CalendarFeed, type CalendarLesson } from './ics.ts';

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
