// 今日と週の画面に出す、利用者の予定 (Issue #144)。予定を期間に展開して、日付ごとの表示用の形にする。
import { eachDate, type CalendarDate, type UserEvent } from '@funmary/core';
import { expandUserEvents } from '@funmary/core/event-expansion';
import { formatOccurrenceTime } from '$lib/event-label.ts';

export interface EventView {
	/** 回ごとに決まる ID (予定の ID と、その回の始まりの日) */
	readonly key: string;
	readonly eventId: number;
	readonly title: string;
	readonly location: string | null;
	/** 例: "終日"、"18:00-19:30"、"2 限から 3 限" */
	readonly time: string;
	/** 時限で決めた予定の、始まりの時限。終日や時刻で決めた予定なら null */
	readonly startPeriod: number | null;
	/** 数日にわたる予定の、2 日目以降 */
	readonly continued: boolean;
	/** ほかの人の予定を、自分の時間割に加えたもの (直せない) */
	readonly added: boolean;
}

/**
 * from から to まで (両端を含む) の各日に、その日にある予定を返す。予定のない日は含めない。
 * addedIds は、events のうち、ほかの人の予定を加えたものの ID
 */
export function eventViewsByDate(
	events: readonly UserEvent[],
	from: CalendarDate,
	to: CalendarDate,
	addedIds: ReadonlySet<number> = new Set(),
): Map<CalendarDate, EventView[]> {
	const byDate = new Map<CalendarDate, EventView[]>();
	// 展開の結果は、始まりの日、時刻の順。日ごとに並べ直すので、終日を先にする
	for (const occurrence of expandUserEvents(events, from, to)) {
		const first = occurrence.startDate < from ? from : occurrence.startDate;
		const last = occurrence.endDate > to ? to : occurrence.endDate;
		for (const date of eachDate(first, last)) {
			byDate.set(date, [
				...(byDate.get(date) ?? []),
				{
					key: occurrence.key,
					eventId: occurrence.eventId,
					title: occurrence.title,
					location: occurrence.location,
					time: formatOccurrenceTime(occurrence),
					startPeriod: occurrence.periods?.from ?? null,
					continued: date > occurrence.startDate,
					added: addedIds.has(occurrence.eventId),
				},
			]);
		}
	}
	for (const [date, views] of byDate) {
		byDate.set(
			date,
			[...views].sort((a, b) => Number(b.time === '終日') - Number(a.time === '終日')),
		);
	}
	return byDate;
}

/** その日だけの予定 */
export function eventsOnDate(
	events: readonly UserEvent[],
	date: CalendarDate,
	addedIds: ReadonlySet<number> = new Set(),
): EventView[] {
	return eventViewsByDate(events, date, date, addedIds).get(date) ?? [];
}
