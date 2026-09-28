// 時間割の画面 (/、/week) に出す表記。
import { addDays, isoWeekday, type CalendarDate } from '@funmary/core';
import type { DayNote } from './server/user-timetable.ts';

const WEEKDAY_NAMES = ['', '月', '火', '水', '木', '金', '土', '日'];

/** 休講などのラベル。休講と主色がどちらも赤なので、色だけで伝えず、必ず文字で出す (設計書 12.3) */
export const STATUS_LABELS = {
	cancelled: '休講',
	makeup: '補講',
	roomChanged: '教室変更',
} as const;

/** 例: "10/5" */
export function formatMonthDay(date: CalendarDate): string {
	return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

/** 例: "(月)" */
export function formatWeekday(date: CalendarDate): string {
	return `(${WEEKDAY_NAMES[isoWeekday(date)]})`;
}

/** 例: "10/5 (月)" */
export function formatDate(date: CalendarDate): string {
	return `${formatMonthDay(date)} ${formatWeekday(date)}`;
}

export function formatDayNote(note: DayNote): string {
	switch (note.kind) {
		case 'substitute':
			return `${WEEKDAY_NAMES[note.weekday]}曜の授業を行う日`;
		case 'noClass':
			return note.label ? `全学の休講日 (${note.label})` : '全学の休講日';
		case 'holiday':
			return note.name;
	}
}

/** 情報を取った日時。例: "今日 12:00"、"10/1 (木) 08:05" */
export function formatFetchedAt(
	fetched: { readonly date: CalendarDate; readonly time: string },
	today: CalendarDate,
): string {
	if (fetched.date === today) return `今日 ${fetched.time}`;
	if (fetched.date === addDays(today, -1)) return `昨日 ${fetched.time}`;
	return `${formatDate(fetched.date)} ${fetched.time}`;
}
