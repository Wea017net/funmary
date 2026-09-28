// カレンダー購読の ICS を組み立てる (設計書 13 章)。入力は保存済みのデータから作った授業と日の予定で、ここでは形を整えるだけ。
import ICAL from 'ical.js';

// ical.js は、折り返した行の先頭の空白を数えずに 75 オクテットで切るので、続きの行が 76 オクテットになる。
// RFC 5545 の上限 (75 オクテット) に収めるため、1 つ短くする
ICAL.foldLength = 74;

/** 1 回分の授業。日付は YYYY-MM-DD、時刻は日本時間の HH:MM */
export interface CalendarLesson {
	readonly date: string;
	readonly period: number;
	/** 時限の時刻。分からない時限なら null で、終日の予定にする */
	readonly start: string | null;
	readonly end: string | null;
	/**
	 * 科目を見分ける値 (例: 2026-100201。年度とシラバスの番号)。予定の UID に使う。
	 * DB の ID は作り直すと変わるので使わない (変わると、購読しているカレンダーの予定が作り直される)
	 */
	readonly subjectKey: string;
	readonly subjectName: string;
	readonly teacher: string | null;
	readonly room: string | null;
	/** 補講の教室が分からず、ふだんの教室を仮に出しているとき true */
	readonly roomIsTentative: boolean;
	readonly status: 'normal' | 'cancelled' | 'makeup' | 'roomChanged';
	readonly detailUrl: string;
	readonly syllabusUrl: string | null;
}

/** 振替授業日や全学の休講日など、終日の予定 */
export interface CalendarDayEvent {
	readonly date: string;
	readonly summary: string;
}

export interface CalendarFeed {
	readonly lessons: readonly CalendarLesson[];
	readonly days: readonly CalendarDayEvent[];
}

export interface IcsOptions {
	/** UID の @ の後ろ。公開の URL のホスト名 */
	readonly uidDomain: string;
	/** DTSTAMP。同じ入力で同じ内容になるよう、呼ぶ側で決める */
	readonly stamp: Date;
}

const PREFIX: Record<CalendarLesson['status'], string> = {
	normal: '',
	cancelled: '[休講] ',
	makeup: '[補講] ',
	roomChanged: '[教室変更] ',
};

export function buildIcs(feed: CalendarFeed, options: IcsOptions): string {
	const calendar = new ICAL.Component('vcalendar');
	calendar.addPropertyWithValue('version', '2.0');
	calendar.addPropertyWithValue('prodid', '-//Funmary//Timetable//JA');
	calendar.addPropertyWithValue('calscale', 'GREGORIAN');
	calendar.addPropertyWithValue('method', 'PUBLISH');
	calendar.addPropertyWithValue('x-wr-calname', 'Funmary の時間割');
	calendar.addPropertyWithValue('x-wr-timezone', 'Asia/Tokyo');
	// 対応するアプリ (Apple のカレンダーなど) に、取りに来る間隔の目安を伝える。VALUE=DURATION は ical.js が付ける
	calendar.addPropertyWithValue('refresh-interval', ICAL.Duration.fromString('PT1H'));
	calendar.addPropertyWithValue('x-published-ttl', 'PT1H');

	const stamp = ICAL.Time.fromJSDate(options.stamp, true);
	for (const lesson of feed.lessons) {
		calendar.addSubcomponent(lessonEvent(lesson, stamp, options.uidDomain));
	}
	for (const day of feed.days) {
		const vevent = new ICAL.Component('vevent');
		vevent.addPropertyWithValue('uid', `${day.date}-day@${options.uidDomain}`);
		vevent.addPropertyWithValue('dtstamp', stamp);
		setAllDay(vevent, day.date);
		vevent.addPropertyWithValue('summary', day.summary);
		vevent.addPropertyWithValue('transp', 'TRANSPARENT');
		calendar.addSubcomponent(vevent);
	}
	return calendar.toString() + '\r\n';
}

function lessonEvent(lesson: CalendarLesson, stamp: ICAL.Time, uidDomain: string) {
	const vevent = new ICAL.Component('vevent');
	vevent.addPropertyWithValue(
		'uid',
		`${lesson.date}-${lesson.period}-${lesson.subjectKey}@${uidDomain}`,
	);
	vevent.addPropertyWithValue('dtstamp', stamp);
	if (lesson.start && lesson.end) {
		vevent.addPropertyWithValue('dtstart', jstTime(lesson.date, lesson.start));
		vevent.addPropertyWithValue('dtend', jstTime(lesson.date, lesson.end));
		vevent.addPropertyWithValue('summary', PREFIX[lesson.status] + lesson.subjectName);
	} else {
		setAllDay(vevent, lesson.date);
		vevent.addPropertyWithValue(
			'summary',
			`${PREFIX[lesson.status]}${lesson.subjectName} (${lesson.period} 限)`,
		);
	}
	if (lesson.room) vevent.addPropertyWithValue('location', lesson.room);
	vevent.addPropertyWithValue('description', description(lesson));
	vevent.addPropertyWithValue('url', lesson.detailUrl);
	// STATUS を出さないアプリもあるので、休講はタイトルの [休講] でも分かるようにしてある
	vevent.addPropertyWithValue('status', lesson.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED');
	if (lesson.status === 'cancelled') vevent.addPropertyWithValue('transp', 'TRANSPARENT');
	return vevent;
}

function description(lesson: CalendarLesson): string {
	const lines = [`${lesson.period} 限`];
	if (lesson.teacher) lines.push(`教員: ${lesson.teacher}`);
	if (lesson.roomIsTentative) {
		lines.push('補講の教室が分からないので、ふだんの教室を出しています。');
	}
	lines.push(`詳細: ${lesson.detailUrl}`);
	if (lesson.syllabusUrl) lines.push(`シラバス: ${lesson.syllabusUrl}`);
	return lines.join('\n');
}

/** 日本時間の日時を、UTC の時刻にする (VTIMEZONE を持たずに済む) */
function jstTime(date: string, time: string): ICAL.Time {
	return ICAL.Time.fromJSDate(new Date(`${date}T${time}:00+09:00`), true);
}

function setAllDay(vevent: ICAL.Component, date: string) {
	const start = ICAL.Time.fromDateString(date);
	const end = start.clone();
	end.adjust(1, 0, 0, 0);
	vevent.addPropertyWithValue('dtstart', start);
	vevent.addPropertyWithValue('dtend', end);
}
