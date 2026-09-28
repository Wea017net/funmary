// 利用者が自分の時間割に足した予定の一覧 (Issue #144)。ここでは、持ち主の予定だけが見える。
import { redirect, type ServerLoad } from '@sveltejs/kit';
import { rruleToRecurrence } from '@funmary/core';
import { describeRecurrence, formatEventTime } from '$lib/event-label.ts';
import { getServices } from '$lib/server/services.ts';
import { formatDate } from '$lib/timetable-label.ts';

export const load: ServerLoad = ({ locals, url }) => {
	if (!locals.user) redirect(303, '/login');
	const events = getServices().userEvents.listByOwner(locals.user.id);
	const saved = url.searchParams.get('saved');
	return {
		message:
			saved === 'created'
				? '予定を足しました。'
				: saved === 'updated'
					? '予定を直しました。'
					: saved === 'deleted'
						? '予定を消しました。'
						: null,
		events: events.map((event) => {
			const recurrence = event.rrule ? rruleToRecurrence(event.rrule) : null;
			return {
				id: event.id,
				title: event.title,
				location: event.location,
				when:
					event.endDate === event.startDate
						? formatDate(event.startDate)
						: `${formatDate(event.startDate)} から ${formatDate(event.endDate)}`,
				time: formatEventTime(event.time),
				// このアプリが作らない繰り返しは、読み戻せない。内容は出さずに、繰り返しであることだけ知らせる
				repeat: event.rrule ? (recurrence ? describeRecurrence(recurrence) : '繰り返し') : null,
			};
		}),
	};
};
