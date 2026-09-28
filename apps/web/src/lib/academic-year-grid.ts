// 管理の学年暦の画面の、1 年分の月の格子 (学年暦の PDF と同じく、4 月から翌年 3 月まで)。
import { addDays, type CalendarDate } from '@funmary/core';

export interface YearGridDay {
	readonly date: CalendarDate;
	readonly day: number;
	/** 0 が日曜 */
	readonly weekday: number;
}

export interface YearGridMonth {
	/** 年の変わり目 (最初の月と 1 月) だけ年を付ける。例: "2026 年 4 月"、"5 月" */
	readonly label: string;
	/** 日曜始まりの週。月の外の日は null */
	readonly weeks: readonly (YearGridDay | null)[][];
}

export function yearGrid(academicYear: number): YearGridMonth[] {
	const months: YearGridMonth[] = [];
	for (let i = 0; i < 12; i++) {
		const year = academicYear + (i >= 9 ? 1 : 0);
		const month = ((i + 3) % 12) + 1;
		const first = `${year}-${String(month).padStart(2, '0')}-01`;
		const cells: (YearGridDay | null)[] = [];
		const offset = new Date(`${first}T00:00:00Z`).getUTCDay();
		for (let k = 0; k < offset; k++) cells.push(null);
		for (let date = first; date.slice(0, 7) === first.slice(0, 7); date = addDays(date, 1)) {
			cells.push({ date, day: Number(date.slice(8)), weekday: cells.length % 7 });
		}
		while (cells.length % 7 !== 0) cells.push(null);
		const weeks: (YearGridDay | null)[][] = [];
		for (let k = 0; k < cells.length; k += 7) weeks.push(cells.slice(k, k + 7));
		months.push({
			label: i === 0 || month === 1 ? `${year} 年 ${month} 月` : `${month} 月`,
			weeks,
		});
	}
	return months;
}

/** 格子で色の帯にする学期。クォーターと通年は前期や後期と重なるので、帯にしない */
export type TermBand = 'spring' | 'fall' | 'summer-intensive' | 'winter-intensive';
const BANDS: readonly TermBand[] = ['spring', 'fall', 'summer-intensive', 'winter-intensive'];

export interface DayMarksInput {
	readonly terms: readonly { term: string; start: string | null; end: string | null }[];
	readonly holidays: readonly { date: string; name: string }[];
	readonly substituteDays: readonly { date: string; weekday: number }[];
	readonly noClassDays: readonly { date: string; label: string | null }[];
}

export interface DayMarks {
	/** その日に掛かる学期 (クォーターなども含む) */
	readonly terms: readonly string[];
	readonly band: TermBand | null;
	readonly holiday: string | null;
	/** 振替授業日なら、行う授業の曜日 (1 が月曜) */
	readonly substitute: number | null;
	readonly noClass: { readonly label: string | null } | null;
}

export function dayMarks(date: CalendarDate, input: DayMarksInput): DayMarks {
	const terms = input.terms
		.filter(
			(term) => term.start !== null && term.end !== null && term.start <= date && date <= term.end,
		)
		.map((term) => term.term);
	const noClass = input.noClassDays.find((day) => day.date === date);
	return {
		terms,
		band: BANDS.find((band) => terms.includes(band)) ?? null,
		holiday: input.holidays.find((holiday) => holiday.date === date)?.name ?? null,
		substitute: input.substituteDays.find((day) => day.date === date)?.weekday ?? null,
		noClass: noClass ? { label: noClass.label } : null,
	};
}
