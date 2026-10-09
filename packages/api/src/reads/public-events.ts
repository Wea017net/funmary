// 利用者の予定 (自分で足した予定と、ほかの人の予定のうち自分の時間割に加えたもの) と、データの新しさ。
// 画面の今日と週の画面が出しているものを、公開 API、MCP、Discord でも同じ形で読めるようにする。
import { isStale, type CalendarDate } from '@funmary/core';
import { expandUserEvents } from '@funmary/core/event-expansion';
import type { SourceHealthStore, UserEventStore } from '@funmary/db';

export interface PublicEvent {
	/** 回ごとに決まる ID */
	readonly key: string;
	readonly eventId: number;
	readonly title: string;
	readonly location: string | null;
	/** 自分の予定のメモ。ほかの人の予定を加えたものは null (持ち主のメモは見せない) */
	readonly notes: string | null;
	readonly startDate: CalendarDate;
	/** この回の終わりの日 (この日を含む) */
	readonly endDate: CalendarDate;
	readonly allDay: boolean;
	/** 終日でないときの、開始と終了の時刻 (日本時間の HH:MM)。時限で決めた予定は、時限の時刻 */
	readonly start: string | null;
	readonly end: string | null;
	/** 時限で決めた予定の、時限の範囲 */
	readonly periods: { readonly from: number; readonly to: number } | null;
	/** ほかの人の予定を、自分の時間割に加えたもの */
	readonly added: boolean;
}

export interface EventSources {
	readonly userEvents: Pick<UserEventStore, 'listByOwner' | 'listSubscribed'>;
}

/** start から end まで (両端を含む) に重なる、利用者の予定の各回。始まりの日、時刻の順 */
export function listUserEventOccurrences(
	sources: EventSources,
	user: { readonly id: string; readonly email: string },
	range: { readonly start: CalendarDate; readonly end: CalendarDate },
): PublicEvent[] {
	const own = sources.userEvents.listByOwner(user.id);
	const added = sources.userEvents.listSubscribed(user);
	const addedIds = new Set(added.map((event) => event.id));
	return expandUserEvents([...own, ...added], range.start, range.end).map((occurrence) => {
		const isAdded = addedIds.has(occurrence.eventId);
		return {
			key: occurrence.key,
			eventId: occurrence.eventId,
			title: occurrence.title,
			location: occurrence.location,
			notes: isAdded ? null : occurrence.notes,
			startDate: occurrence.startDate,
			endDate: occurrence.endDate,
			allDay: occurrence.allDay,
			start: occurrence.start,
			end: occurrence.end,
			periods: occurrence.periods,
			added: isAdded,
		};
	});
}

/** 学生ポータルから授業のデータを取ったときの、取得元の名前 (@funmary/jobs の PORTAL_SOURCE と同じ) */
const PORTAL_SOURCE = 'portal';

export interface DataStatus {
	readonly timetable: {
		/** 最後に取得に成功した日時 (ISO 8601)。一度も成功していなければ null */
		readonly lastSuccessAt: string | null;
		/** 情報が古い。休講や教室の変更が、まだ反映されていないかもしれない */
		readonly stale: boolean;
	};
}

export interface StatusSources {
	readonly sourceHealth: Pick<SourceHealthStore, 'load'>;
}

/** 休講や教室の変更を取っているデータが、新しいか */
export function getDataStatus(sources: StatusSources, now: Date): DataStatus {
	const health = sources.sourceHealth.load(PORTAL_SOURCE);
	return {
		timetable: {
			lastSuccessAt: health.lastSuccessAt?.toISOString() ?? null,
			stale: isStale(health.lastSuccessAt, now),
		},
	};
}
