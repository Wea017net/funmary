// 予定の一覧や詳細に出す、表示用の文 (Issue #144、#145)。持ち主の情報は含めない。
import { rruleToRecurrence, type UserEvent } from '@funmary/core';
import { describeRecurrence, formatEventTime } from '$lib/event-label.ts';
import { formatDate } from '$lib/timetable-label.ts';

export interface EventSummary {
	readonly id: number;
	readonly title: string;
	readonly location: string | null;
	readonly notes: string | null;
	/** 例: "10/5 (月)"、"10/5 (月) から 10/8 (木)" */
	readonly when: string;
	/** 例: "終日"、"18:00-19:30"、"2 限から 3 限" */
	readonly time: string;
	/** 例: "毎週 月、水"。繰り返さなければ null */
	readonly repeat: string | null;
}

export function summarizeEvent(event: UserEvent): EventSummary {
	const recurrence = event.rrule ? rruleToRecurrence(event.rrule) : null;
	return {
		id: event.id,
		title: event.title,
		location: event.location,
		notes: event.notes,
		when:
			event.endDate === event.startDate
				? formatDate(event.startDate)
				: `${formatDate(event.startDate)} から ${formatDate(event.endDate)}`,
		time: formatEventTime(event.time),
		// このアプリが作らない繰り返しは、読み戻せない。内容は出さずに、繰り返しであることだけ知らせる
		repeat: event.rrule ? (recurrence ? describeRecurrence(recurrence) : '繰り返し') : null,
	};
}
