// 利用者が自分の時間割に足す予定の型と、画面で選ぶ繰り返しの指定 (設計書 11 章、Issue #144)。
// 繰り返しは RFC 5545 の RRULE として持つ。日付への展開は、ical.js に任せる (event-expansion.ts)。
// ここは ical.js を読み込まない。画面側 (ブラウザの JavaScript) からも読まれるので、大きな依存を持ち込まないため。
// I/O を持たない。日付は "YYYY-MM-DD"、時刻は日本時間の "HH:MM"。
import type { CalendarDate, Weekday } from './calendar-date.ts';

/** 予定の時間。終日、時刻 (同じ日の中)、時限 (from から to まで。1 限から 6 限) のどれか */
export type EventTime =
	| { readonly kind: 'allDay' }
	| { readonly kind: 'time'; readonly start: string; readonly end: string }
	| { readonly kind: 'period'; readonly from: number; readonly to: number };

export interface UserEvent {
	readonly id: number;
	readonly title: string;
	readonly location: string | null;
	readonly notes: string | null;
	/** 始まりの日 */
	readonly startDate: CalendarDate;
	/** 終わりの日 (この日を含む)。単発なら startDate と同じ */
	readonly endDate: CalendarDate;
	readonly time: EventTime;
	/** RFC 5545 の RRULE の値 (例: "FREQ=WEEKLY;BYDAY=MO,WE")。繰り返さないなら null */
	readonly rrule: string | null;
	/** 繰り返しから除く日 (始まりの日で数える) */
	readonly excludedDates: readonly CalendarDate[];
}

/** 予定の 1 回分。期間に重なるものだけを返す */
export interface EventOccurrence {
	/** 回ごとに決まる、変わらない ID。UID や画面の並びの識別に使う */
	readonly key: string;
	readonly eventId: number;
	readonly title: string;
	readonly location: string | null;
	readonly notes: string | null;
	readonly startDate: CalendarDate;
	/** この回の終わりの日 (この日を含む) */
	readonly endDate: CalendarDate;
	readonly allDay: boolean;
	/** 終日でないときの、開始と終了の時刻 */
	readonly start: string | null;
	readonly end: string | null;
	/** 時限で決めた予定の、時限の範囲 */
	readonly periods: { readonly from: number; readonly to: number } | null;
}

// ---------------------------------------------------------------------------
// 繰り返しの指定 (Google カレンダーと同じ項目)

export type RecurrenceEnd =
	| { readonly kind: 'never' }
	| { readonly kind: 'until'; readonly date: CalendarDate }
	| { readonly kind: 'count'; readonly count: number };

export type Recurrence =
	| { readonly freq: 'daily' | 'yearly'; readonly interval: number; readonly end: RecurrenceEnd }
	| {
			readonly freq: 'weekly';
			readonly interval: number;
			/** 選んだ曜日。空なら、始まりの日の曜日 */
			readonly weekdays: readonly Weekday[];
			readonly end: RecurrenceEnd;
	  }
	| {
			readonly freq: 'monthly';
			readonly interval: number;
			/** 日付 (始まりの日と同じ日) か、第何曜日か (nth の -1 は最終週) */
			readonly monthly:
				| { readonly by: 'day' }
				| { readonly by: 'nth'; readonly nth: 1 | 2 | 3 | 4 | 5 | -1; readonly weekday: Weekday };
			readonly end: RecurrenceEnd;
	  };

const WEEKDAY_CODES = ['', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
const FREQUENCIES = {
	DAILY: 'daily',
	WEEKLY: 'weekly',
	MONTHLY: 'monthly',
	YEARLY: 'yearly',
} as const;

const weekdayOf = (date: CalendarDate): Weekday => {
	const day = new Date(`${date}T00:00:00Z`).getUTCDay();
	return (day === 0 ? 7 : day) as Weekday;
};

/** 画面で選んだ繰り返しを、RRULE の値にする。始まりの日は、曜日や日付を選ばなかったときの既定に使う */
export function recurrenceToRrule(recurrence: Recurrence, startDate: CalendarDate): string {
	const parts = [`FREQ=${recurrence.freq.toUpperCase()}`];
	if (recurrence.interval > 1) parts.push(`INTERVAL=${recurrence.interval}`);
	if (recurrence.freq === 'weekly') {
		const weekdays = recurrence.weekdays.length > 0 ? recurrence.weekdays : [weekdayOf(startDate)];
		const sorted = [...new Set(weekdays)].sort((a, b) => a - b);
		parts.push(`BYDAY=${sorted.map((weekday) => WEEKDAY_CODES[weekday]).join(',')}`);
	} else if (recurrence.freq === 'monthly') {
		parts.push(
			recurrence.monthly.by === 'day'
				? `BYMONTHDAY=${Number(startDate.slice(8, 10))}`
				: `BYDAY=${recurrence.monthly.nth}${WEEKDAY_CODES[recurrence.monthly.weekday]}`,
		);
	}
	if (recurrence.end.kind === 'count') parts.push(`COUNT=${recurrence.end.count}`);
	if (recurrence.end.kind === 'until')
		parts.push(`UNTIL=${recurrence.end.date.replaceAll('-', '')}`);
	return parts.join(';');
}

/** RRULE の値を、画面で選べる形に戻す。このアプリが作らない形や、壊れた指定は null */
export function rruleToRecurrence(rrule: string): Recurrence | null {
	const fields = new Map<string, string>();
	for (const part of rrule.split(';')) {
		const [key, value, ...rest] = part.split('=');
		if (!key || !value || rest.length > 0 || fields.has(key)) return null;
		fields.set(key, value);
	}
	const allowed = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'COUNT', 'UNTIL']);
	if ([...fields.keys()].some((key) => !allowed.has(key))) return null;

	const freqCode = fields.get('FREQ');
	const freq = freqCode ? FREQUENCIES[freqCode as keyof typeof FREQUENCIES] : undefined;
	if (!freq) return null;

	const interval = fields.has('INTERVAL') ? Number(fields.get('INTERVAL')) : 1;
	if (!Number.isInteger(interval) || interval < 1) return null;

	let end: RecurrenceEnd = { kind: 'never' };
	if (fields.has('COUNT') && fields.has('UNTIL')) return null;
	if (fields.has('COUNT')) {
		const count = Number(fields.get('COUNT'));
		if (!Number.isInteger(count) || count < 1) return null;
		end = { kind: 'count', count };
	}
	const until = fields.get('UNTIL');
	if (until !== undefined) {
		const match = /^(\d{4})(\d{2})(\d{2})$/.exec(until);
		if (!match) return null;
		end = { kind: 'until', date: `${match[1]}-${match[2]}-${match[3]}` };
	}

	const byDay = fields.get('BYDAY');
	const byMonthDay = fields.get('BYMONTHDAY');
	if (freq === 'weekly') {
		if (byMonthDay !== undefined || byDay === undefined) return null;
		const weekdays = byDay.split(',').map((code) => WEEKDAY_CODES.indexOf(code as never));
		if (weekdays.some((weekday) => weekday < 1)) return null;
		return { freq, interval, weekdays: weekdays as Weekday[], end };
	}
	if (freq === 'monthly') {
		if (byDay !== undefined && byMonthDay === undefined) {
			const match = /^(-1|[1-5])(MO|TU|WE|TH|FR|SA|SU)$/.exec(byDay);
			if (!match) return null;
			return {
				freq,
				interval,
				monthly: {
					by: 'nth',
					nth: Number(match[1]) as 1 | 2 | 3 | 4 | 5 | -1,
					weekday: WEEKDAY_CODES.indexOf(match[2] as never) as Weekday,
				},
				end,
			};
		}
		if (byMonthDay !== undefined && byDay === undefined && /^\d{1,2}$/.test(byMonthDay)) {
			return { freq, interval, monthly: { by: 'day' }, end };
		}
		return null;
	}
	if (byDay !== undefined || byMonthDay !== undefined) return null;
	return { freq, interval, end };
}
