// バスの発車表の計算。取得した発車表 (停留所ごと、のりばと曜日の区分ごと) から、今から先の発車を選ぶ。
// I/O は持たない。現在時刻と祝日は引数で受け取る。
import { addDays, isoWeekday, type CalendarDate } from './calendar-date.ts';

/** 発車表の区分。weekday は平日、holiday は土曜、日曜、祝日 */
export type BusDayType = 'weekday' | 'holiday';

export interface BusDeparture {
	/** "HH:MM"。深夜をまたぐ発車は、時が 24 以上になる */
	readonly time: string;
	readonly routes: readonly string[];
	readonly via?: string | undefined;
	readonly destination?: string | undefined;
	readonly marks: readonly string[];
}

export interface BusPlatformTimetable {
	readonly platformNo: number;
	readonly platformName?: string | undefined;
	readonly day: BusDayType;
	readonly notes: readonly string[];
	readonly departures: readonly BusDeparture[];
}

export interface UpcomingBusDeparture {
	readonly platformNo: number;
	readonly platformName?: string | undefined;
	readonly departure: BusDeparture;
	/** この発車が属するダイヤの日。24 時以降の発車は、日付が変わったあとも前日のダイヤで数える */
	readonly serviceDate: CalendarDate;
	/** 今から発車までの分 */
	readonly minutesUntil: number;
}

/** ダイヤの版。code は有効になる日の 8 桁 (20261001) */
export interface BusGeneration {
	readonly code: number;
	readonly name: string;
	readonly current: boolean;
}

export interface BusStop {
	readonly id: string;
	readonly name: string;
}

/** 停留所の一覧と、ダイヤの版の一覧 */
export interface BusCatalog {
	readonly generatedAt: string;
	readonly generations: readonly BusGeneration[];
	readonly stops: readonly BusStop[];
}

/** 1 つの停留所の、ある版の発車表 */
export interface BusStopTimetable {
	readonly generatedAt: string;
	readonly fetchedAt?: string | undefined;
	readonly generation: BusGeneration;
	readonly stop: BusStop;
	readonly timetables: readonly BusPlatformTimetable[];
}

/** 利用者が自分の乗り降りする停留所を決めるまでの、既定の強調。はこだて未来大学と、亀田支所前 */
export const DEFAULT_BUS_STOP_IDS: readonly string[] = ['14023', '14013'];

/**
 * 日付に有効な版 (有効になる日が date 以前のうち、いちばん新しいもの)。
 * 保存した一覧の current の印は、一覧を取った日の時点のものなので、日付から選び直す。
 * どの版もまだ有効でなければ、いちばん古い版を返す
 */
export function generationForDate(
	generations: readonly BusGeneration[],
	date: CalendarDate,
): BusGeneration | null {
	const sorted = [...generations].sort((a, b) => a.code - b.code);
	const today = Number(date.replaceAll('-', ''));
	return sorted.findLast((generation) => generation.code <= today) ?? sorted[0] ?? null;
}

export function busDayType(date: CalendarDate, holidays: ReadonlySet<CalendarDate>): BusDayType {
	return isoWeekday(date) >= 6 || holidays.has(date) ? 'holiday' : 'weekday';
}

function minutesOf(time: string): number {
	const [hours, minutes] = time.split(':').map(Number);
	return (hours ?? 0) * 60 + (minutes ?? 0);
}

export interface UpcomingBusInput {
	readonly now: { readonly date: CalendarDate; readonly time: string };
	readonly holidays: ReadonlySet<CalendarDate>;
	readonly limit: number;
}

/**
 * 今の時刻以降の発車を、近い順に limit 件まで返す。
 * 前日 (深夜便)、当日、翌日のダイヤを見るので、最終のあとは翌日の始発になる。
 */
export function upcomingDepartures(
	timetables: readonly BusPlatformTimetable[],
	{ now, holidays, limit }: UpcomingBusInput,
): UpcomingBusDeparture[] {
	const nowMinutes = minutesOf(now.time);
	const found: UpcomingBusDeparture[] = [];
	for (const dayOffset of [-1, 0, 1]) {
		const serviceDate = addDays(now.date, dayOffset);
		const day = busDayType(serviceDate, holidays);
		for (const timetable of timetables) {
			if (timetable.day !== day) continue;
			for (const departure of timetable.departures) {
				const minutesUntil = dayOffset * 24 * 60 + minutesOf(departure.time) - nowMinutes;
				if (minutesUntil < 0) continue;
				found.push({
					platformNo: timetable.platformNo,
					platformName: timetable.platformName,
					departure,
					serviceDate,
					minutesUntil,
				});
			}
		}
	}
	found.sort((a, b) => a.minutesUntil - b.minutesUntil || a.platformNo - b.platformNo);
	return found.slice(0, limit);
}
