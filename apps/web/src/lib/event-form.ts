// 予定の追加と編集のフォーム (Issue #144)。ブラウザから来る値は信用せず、ここで検査して、UserEvent の形にする。
// 繰り返しの選び方は、Google カレンダーと同じ項目にして、RRULE に直す。編集では、保存した予定を、同じ項目に戻す。
// ical.js は読み込まない (画面側からも読まれるので、大きな依存を持ち込まないため)。
import {
	isoWeekday,
	recurrenceToRrule,
	rruleToRecurrence,
	type EventTime,
	type Recurrence,
	type RecurrenceEnd,
	type UserEvent,
	type Weekday,
} from '@funmary/core';

/** 公開範囲。private は本人だけ、link は共有のリンクを知っている人、public はログインしている全員 */
export type Visibility = 'private' | 'link' | 'public';
export const VISIBILITIES: readonly Visibility[] = ['private', 'link', 'public'];

/** 公開範囲。知らない値や、空は、非公開にする (誤って公開しないため) */
function parseVisibility(value: string): Visibility {
	return (VISIBILITIES as readonly string[]).includes(value) ? (value as Visibility) : 'private';
}

export type EventInput = Omit<UserEvent, 'id'> & { readonly visibility: Visibility };

/** フォームの欄の値。すべて文字列 (入力欄の値のまま) */
export interface EventFormValues {
	title: string;
	location: string;
	notes: string;
	startDate: string;
	endDate: string;
	timeKind: 'allDay' | 'time' | 'period';
	startTime: string;
	endTime: string;
	startPeriod: string;
	endPeriod: string;
	repeat: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
	interval: string;
	weekdays: string[];
	monthlyMode: 'day' | 'nth' | 'last';
	endKind: 'never' | 'until' | 'count';
	untilDate: string;
	count: string;
	excludedDates: string[];
	visibility: Visibility;
}

export type EventFormResult =
	| { readonly ok: true; readonly value: EventInput }
	| { readonly ok: false; readonly error: string };

const TITLE_MAX = 100;
const LOCATION_MAX = 100;
const NOTES_MAX = 1000;
/** 数日にわたる予定の、最長の日数 */
const SPAN_MAX_DAYS = 60;
const PERIODS = [1, 2, 3, 4, 5, 6];

/** 今日の日付を、初期値の開始日にするための空のフォーム */
export function emptyFormValues(startDate: string): EventFormValues {
	return {
		title: '',
		location: '',
		notes: '',
		startDate,
		endDate: '',
		timeKind: 'time',
		startTime: '18:00',
		endTime: '19:00',
		startPeriod: '1',
		endPeriod: '1',
		repeat: 'none',
		interval: '1',
		weekdays: [],
		monthlyMode: 'day',
		endKind: 'never',
		untilDate: '',
		count: '10',
		excludedDates: [],
		visibility: 'private',
	};
}

const isDate = (value: string) => {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const isTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const text = (form: FormData, name: string) => {
	const value = form.get(name);
	return typeof value === 'string' ? value.trim() : '';
};
const daysBetween = (start: string, end: string) =>
	Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
const integer = (value: string, min: number, max: number) => {
	if (!/^\d+$/.test(value)) return null;
	const number = Number(value);
	return number >= min && number <= max ? number : null;
};
const fail = (error: string): EventFormResult => ({ ok: false, error });

function parseTime(form: FormData, spans: boolean): EventTime | string {
	const kind = text(form, 'timeKind');
	if (spans && kind !== 'allDay') return '数日にわたる予定は、終日だけ選べます。';
	if (kind === 'allDay') return { kind: 'allDay' };
	if (kind === 'time') {
		const start = text(form, 'startTime');
		const end = text(form, 'endTime');
		if (!isTime(start) || !isTime(end)) return '時刻は、「時:分」の形で入れてください。';
		if (end <= start) return '終わりの時刻は、始まりより後にしてください。';
		return { kind: 'time', start, end };
	}
	if (kind === 'period') {
		const from = integer(text(form, 'startPeriod'), 1, PERIODS.length);
		const to = integer(text(form, 'endPeriod'), 1, PERIODS.length);
		if (from === null || to === null) return '時限は、1 限から 6 限までで選んでください。';
		if (to < from) return '終わりの時限は、始まりと同じか、それより後にしてください。';
		return { kind: 'period', from, to };
	}
	return '時間の選び方が正しくありません。';
}

function parseRecurrence(
	form: FormData,
	startDate: string,
): { rrule: string | null } | { error: string } {
	const repeat = text(form, 'repeat');
	if (repeat === '' || repeat === 'none') return { rrule: null };
	if (!['daily', 'weekly', 'monthly', 'yearly'].includes(repeat)) {
		return { error: '繰り返しの選び方が正しくありません。' };
	}
	const interval = integer(text(form, 'interval') || '1', 1, 99);
	if (interval === null) return { error: '繰り返しの間隔は、1 から 99 までで入れてください。' };

	let end: RecurrenceEnd = { kind: 'never' };
	const endKind = text(form, 'endKind');
	if (endKind === 'count') {
		const count = integer(text(form, 'count'), 1, 999);
		if (count === null) return { error: '繰り返す回数は、1 から 999 までで入れてください。' };
		end = { kind: 'count', count };
	} else if (endKind === 'until') {
		const date = text(form, 'untilDate');
		if (!isDate(date)) return { error: '繰り返しの終わりの日を、日付で入れてください。' };
		if (date < startDate) return { error: '繰り返しの終わりの日は、開始日以降にしてください。' };
		end = { kind: 'until', date };
	}

	let recurrence: Recurrence;
	if (repeat === 'weekly') {
		const weekdays = form
			.getAll('weekday')
			.map((value) => (typeof value === 'string' ? integer(value, 1, 7) : null))
			.filter((value): value is number => value !== null) as Weekday[];
		recurrence = { freq: 'weekly', interval, weekdays, end };
	} else if (repeat === 'monthly') {
		const mode = text(form, 'monthlyMode');
		const weekday = isoWeekday(startDate);
		const nth = Math.ceil(Number(startDate.slice(8, 10)) / 7) as 1 | 2 | 3 | 4 | 5;
		recurrence = {
			freq: 'monthly',
			interval,
			monthly:
				mode === 'nth'
					? { by: 'nth', nth, weekday }
					: mode === 'last'
						? { by: 'nth', nth: -1, weekday }
						: { by: 'day' },
			end,
		};
	} else {
		recurrence = { freq: repeat as 'daily' | 'yearly', interval, end };
	}
	return { rrule: recurrenceToRrule(recurrence, startDate) };
}

/** フォームの値を検査して、予定にする。誤りがあれば、直し方が分かる文を返す */
export function parseEventForm(form: FormData): EventFormResult {
	const title = text(form, 'title');
	if (title === '') return fail('予定の名前を入れてください。');
	if (title.length > TITLE_MAX) return fail(`予定の名前は ${TITLE_MAX} 文字までにしてください。`);
	const location = text(form, 'location');
	if (location.length > LOCATION_MAX)
		return fail(`場所は ${LOCATION_MAX} 文字までにしてください。`);
	const notes = text(form, 'notes');
	if (notes.length > NOTES_MAX) return fail(`メモは ${NOTES_MAX} 文字までにしてください。`);

	const startDate = text(form, 'startDate');
	if (!isDate(startDate)) return fail('開始日を、日付で入れてください。');
	const endInput = text(form, 'endDate');
	const endDate = endInput === '' ? startDate : endInput;
	if (!isDate(endDate)) return fail('終了日を、日付で入れてください。');
	if (endDate < startDate) return fail('終了日は、開始日以降にしてください。');
	if (daysBetween(startDate, endDate) >= SPAN_MAX_DAYS) {
		return fail(`予定の期間は ${SPAN_MAX_DAYS} 日までにしてください。`);
	}

	const time = parseTime(form, endDate > startDate);
	if (typeof time === 'string') return fail(time);
	const recurrence = parseRecurrence(form, startDate);
	if ('error' in recurrence) return fail(recurrence.error);

	// 除く日は、繰り返す予定だけに付ける。正しい日付だけを、重複なく残す
	const excludedDates =
		recurrence.rrule === null
			? []
			: [
					...new Set(
						form
							.getAll('exclude')
							.filter((value): value is string => typeof value === 'string' && isDate(value)),
					),
				].sort();

	return {
		ok: true,
		value: {
			title,
			location: location === '' ? null : location,
			notes: notes === '' ? null : notes,
			startDate,
			endDate,
			time,
			rrule: recurrence.rrule,
			excludedDates,
			visibility: parseVisibility(text(form, 'visibility')),
		},
	};
}

/** 保存した予定を、編集のフォームの値に戻す。このアプリが作らない繰り返しは、繰り返しなしとして戻す */
export function toFormValues(event: UserEvent & { visibility?: Visibility }): EventFormValues {
	const values: EventFormValues = {
		...emptyFormValues(event.startDate),
		title: event.title,
		location: event.location ?? '',
		notes: event.notes ?? '',
		endDate: event.endDate === event.startDate ? '' : event.endDate,
		timeKind: event.time.kind,
		excludedDates: [...event.excludedDates],
		visibility: event.visibility ?? 'private',
	};
	if (event.time.kind === 'time') {
		values.startTime = event.time.start;
		values.endTime = event.time.end;
	} else if (event.time.kind === 'period') {
		values.startPeriod = String(event.time.from);
		values.endPeriod = String(event.time.to);
	}
	const recurrence = event.rrule ? rruleToRecurrence(event.rrule) : null;
	if (!recurrence) return { ...values, excludedDates: [] };
	values.repeat = recurrence.freq;
	values.interval = String(recurrence.interval);
	if (recurrence.freq === 'weekly') values.weekdays = recurrence.weekdays.map(String);
	if (recurrence.freq === 'monthly') {
		values.monthlyMode =
			recurrence.monthly.by === 'day' ? 'day' : recurrence.monthly.nth === -1 ? 'last' : 'nth';
	}
	values.endKind = recurrence.end.kind;
	if (recurrence.end.kind === 'until') values.untilDate = recurrence.end.date;
	if (recurrence.end.kind === 'count') values.count = String(recurrence.end.count);
	return values;
}

/** 誤りで送り返すときに、入力した値を、そのまま画面に戻す (読めない欄は空にする) */
export function echoFormValues(form: FormData, fallbackStartDate: string): EventFormValues {
	const base = emptyFormValues(fallbackStartDate);
	const pick = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
		const value = text(form, name);
		return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
	};
	return {
		title: text(form, 'title'),
		location: text(form, 'location'),
		notes: text(form, 'notes'),
		startDate: text(form, 'startDate') || fallbackStartDate,
		endDate: text(form, 'endDate'),
		timeKind: pick('timeKind', ['allDay', 'time', 'period'], base.timeKind),
		startTime: text(form, 'startTime') || base.startTime,
		endTime: text(form, 'endTime') || base.endTime,
		startPeriod: text(form, 'startPeriod') || base.startPeriod,
		endPeriod: text(form, 'endPeriod') || base.endPeriod,
		repeat: pick('repeat', ['none', 'daily', 'weekly', 'monthly', 'yearly'], base.repeat),
		interval: text(form, 'interval') || base.interval,
		weekdays: form.getAll('weekday').filter((value): value is string => typeof value === 'string'),
		monthlyMode: pick('monthlyMode', ['day', 'nth', 'last'], base.monthlyMode),
		endKind: pick('endKind', ['never', 'until', 'count'], base.endKind),
		untilDate: text(form, 'untilDate'),
		count: text(form, 'count') || base.count,
		excludedDates: form
			.getAll('exclude')
			.filter((value): value is string => typeof value === 'string'),
		visibility: parseVisibility(text(form, 'visibility')),
	};
}
