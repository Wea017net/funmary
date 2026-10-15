// 「停留所 A から未来大へ」「未来大から A へ」の向きの判定。
// 時刻表の API は、停留所ごとの発車表で、便が次にどこへ行くかの並びを持たない。
// そこで、発車表の「経由」と「行き先」の文字から向きを決める。
// 55 系統はどれも未来大を通る (函館駅前、未来大、赤川の順に並ぶ) ので、次のように決められる。
// - A から未来大へ: A の発車のうち、経由か行き先に未来大があるもの
// - 未来大から A へ: 未来大の発車のうち、行き先が「A から未来大と反対へ向かう便」の行き先と同じもの
//   (その便は、未来大を通ってから A を通る)。または、経由か行き先に A があるもの
// I/O は持たない。
import type { BusPlatformTimetable, BusStop, BusStopTimetable } from './bus.ts';

/** 向き。toUniversity は A から未来大へ、fromUniversity は未来大から A へ */
export type BusDirection = 'toUniversity' | 'fromUniversity';
export const BUS_DIRECTIONS: readonly BusDirection[] = ['toUniversity', 'fromUniversity'];

export interface BusUniversityStop extends BusStop {
	/** 経由や行き先で、停留所名の代わりに使われる短い呼び名。例: 未来大 */
	readonly aliases?: readonly string[];
}

/** 未来大の停留所の既定 */
export const UNIVERSITY_STOP: BusUniversityStop = {
	id: '14023',
	name: 'はこだて未来大学',
	aliases: ['未来大'],
};

/**
 * 路線が二つに分かれる停留所。亀田支所前から先で、五稜郭の側と昭和の側に分かれ、未来大の側では合流する。
 * 選んだ停留所が通らない系統の便は、この停留所と未来大の間の便として足す
 */
export const BRANCH_JUNCTION_STOP: BusStop = { id: '14013', name: '亀田支所前' };

/** 全角と半角、空白の違いを無視して比べるための形 */
const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/g, '');

/** 経由や行き先の文に、停留所の名前 (または呼び名) が入っているか */
export function mentionsStop(
	text: string | undefined,
	name: string,
	aliases: readonly string[] = [],
): boolean {
	if (text === undefined) return false;
	const haystack = normalize(text);
	return [name, ...aliases].some((candidate) => haystack.includes(normalize(candidate)));
}

type Departure = BusPlatformTimetable['departures'][number];

const withDepartures = (
	timetables: readonly BusPlatformTimetable[],
	keep: (departure: Departure) => boolean,
): BusPlatformTimetable[] =>
	timetables.map((timetable) => ({
		...timetable,
		departures: timetable.departures.filter(keep),
	}));

export interface DirectionalTimetables {
	/** 発車する停留所。toUniversity なら A、fromUniversity なら未来大 */
	readonly stop: BusStop;
	/** その向きの発車だけに絞った、のりばと日の区分ごとの発車表 */
	readonly timetables: readonly BusPlatformTimetable[];
}

/**
 * A (stop) の発車表から、未来大へ向かう行き先の集まりを求める。
 * 同じ行き先の便は、同じ向きに進む。経由に未来大と書かれた便が半分以上ある行き先を「未来大へ向かう」とする
 * (経由は一部の停留所しか書かれないので、1 便ずつではなく、行き先ごとに決める)。
 * 経由に未来大と書かれた便が 1 つもない停留所 (始発の停留所など) は、どの便も未来大を通るので、すべての行き先を含める
 */
function destinationsTowardUniversity(
	stop: BusStopTimetable,
	universityStop: BusUniversityStop,
): { readonly toward: ReadonlySet<string>; readonly away: ReadonlySet<string> } {
	const counts = new Map<string, { total: number; mentions: number }>();
	for (const departure of stop.timetables.flatMap((timetable) => timetable.departures)) {
		if (departure.destination === undefined) continue;
		const key = normalize(departure.destination);
		const entry = counts.get(key) ?? { total: 0, mentions: 0 };
		entry.total += 1;
		if (
			mentionsStop(departure.via, universityStop.name, universityStop.aliases) ||
			mentionsStop(departure.destination, universityStop.name, universityStop.aliases)
		) {
			entry.mentions += 1;
		}
		counts.set(key, entry);
	}
	const anyMention = [...counts.values()].some((entry) => entry.mentions > 0);
	const toward = new Set<string>();
	const away = new Set<string>();
	for (const [destination, entry] of counts) {
		if (!anyMention || entry.mentions * 2 >= entry.total) toward.add(destination);
		else away.add(destination);
	}
	return { toward, away };
}

/**
 * A (stop) と未来大の発車表から、向きに合う発車だけを残す。どちらかの発車表がなければ null。
 * 経由と行き先は、事業者が時刻表に書いた文字なので、ここでは文字の一致だけを見る
 */
export function filterByDirection(
	direction: BusDirection,
	stop: BusStopTimetable | null,
	university: BusStopTimetable | null,
	universityStop: BusUniversityStop = UNIVERSITY_STOP,
): DirectionalTimetables | null {
	if (!stop || !university) return null;
	const { toward, away } = destinationsTowardUniversity(stop, universityStop);
	const destinationOf = (departure: Departure) =>
		departure.destination === undefined ? null : normalize(departure.destination);

	if (direction === 'toUniversity') {
		return {
			stop: stop.stop,
			timetables: withDepartures(stop.timetables, (departure) => {
				const destination = destinationOf(departure);
				return (
					(destination !== null && toward.has(destination)) ||
					mentionsStop(departure.via, universityStop.name, universityStop.aliases)
				);
			}),
		};
	}

	// 未来大の発車のうち、A から未来大と反対へ向かう行き先の便は、未来大を通ってから A を通る
	const passesStop = (departure: Departure) => {
		const destination = destinationOf(departure);
		return (
			(destination !== null && away.has(destination)) ||
			mentionsStop(departure.via, stop.stop.name) ||
			mentionsStop(departure.destination, stop.stop.name)
		);
	};
	return { stop: university.stop, timetables: withDepartures(university.timetables, passesStop) };
}

/** 出発から到着までの、いちばん長い時間 (分)。これより離れた便は、同じ便とみなさない */
const MAX_TRAVEL_MINUTES = 45;

const minutesOf = (time: string) => {
	const [hours, minutes] = time.split(':').map(Number);
	return (hours ?? 0) * 60 + (minutes ?? 0);
};

/**
 * 出発する停留所の発車 (from) に、到着する停留所の発車 (to) から、同じ便の到着の時刻を結ぶ。
 * 時刻表には便をたどる情報がないので、同じ行き先で、系統が重なり、あとに発車する便を、時刻の順に 1 対 1 で結ぶ。
 * 結べなければ null。from は時刻の順に並んでいるものとする
 */
export function matchArrivals(
	from: readonly Departure[],
	to: readonly Departure[],
): (string | null)[] {
	const used = new Set<number>();
	return from.map((departure) => {
		const destination =
			departure.destination === undefined ? null : normalize(departure.destination);
		if (destination === null) return null;
		const start = minutesOf(departure.time);
		let best: { index: number; minutes: number } | null = null;
		to.forEach((candidate, index) => {
			if (used.has(index) || candidate.destination === undefined) return;
			if (normalize(candidate.destination) !== destination) return;
			if (!candidate.routes.some((route) => departure.routes.includes(route))) return;
			const elapsed = minutesOf(candidate.time) - start;
			if (elapsed <= 0 || elapsed > MAX_TRAVEL_MINUTES) return;
			if (best === null || elapsed < best.minutes) best = { index, minutes: elapsed };
		});
		if (best === null) return null;
		used.add((best as { index: number }).index);
		return to[(best as { index: number }).index]?.time ?? null;
	});
}
