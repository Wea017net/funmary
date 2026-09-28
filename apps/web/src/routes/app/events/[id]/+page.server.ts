// 予定を直す、消す (Issue #144)。持ち主の予定だけを開ける。ほかの人の予定は、見つからないことにする。
import { error, fail, redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import { addDays, jstDateTime } from '@funmary/core';
import { expandUserEvents } from '@funmary/core/event-expansion';
import { echoFormValues, parseEventForm, toFormValues } from '$lib/event-form.ts';
import { formatEventTime } from '$lib/event-label.ts';
import { getServices } from '$lib/server/services.ts';
import { formatDate } from '$lib/timetable-label.ts';

/** 「この日は除く」に出す、これからの回の数と、見る先の日数 */
const CANDIDATES = 24;
const LOOK_AHEAD_DAYS = 400;

const parseId = (value: string | undefined) =>
	value && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : null;

export const load: ServerLoad = ({ locals, params, url }) => {
	if (!locals.user) redirect(303, '/login');
	const id = parseId(params['id']);
	const event = id === null ? null : getServices().userEvents.get(id, locals.user.id);
	if (!event) error(404, '予定が見つかりません');

	// 除く日を選ぶための、これからの各回。すでに除いた日も出すので、除く日なしで展開する
	const today = jstDateTime(new Date()).date;
	const candidates = event.rrule
		? expandUserEvents([{ ...event, excludedDates: [] }], today, addDays(today, LOOK_AHEAD_DAYS))
				.slice(0, CANDIDATES)
				.map((occurrence) => ({
					date: occurrence.startDate,
					label: `${formatDate(occurrence.startDate)} ${formatEventTime(event.time)}`,
				}))
		: [];
	const shown = new Set(candidates.map((candidate) => candidate.date));
	return {
		values: toFormValues(event),
		candidates,
		// 候補の外にある (過去や、遠い先の) 除く日は、消さずに残す
		keptExclusions: event.excludedDates.filter((date) => !shown.has(date)),
		// 限定公開のときの、共有のリンク
		shareUrl: event.shareToken ? `${url.origin}/app/events/shared/${event.shareToken}` : null,
	};
};

export const actions: Actions = {
	/** 名前付きの操作 (delete) があるので、保存も名前を付ける。標準の操作は、同じページに置けない */
	save: async ({ request, locals, params }) => {
		if (!locals.user) redirect(303, '/login');
		const id = parseId(params['id']);
		if (id === null) error(404, '予定が見つかりません');
		const form = await request.formData();
		const parsed = parseEventForm(form);
		if (!parsed.ok) {
			return fail(400, {
				error: parsed.error,
				values: echoFormValues(form, jstDateTime(new Date()).date),
			});
		}
		if (!getServices().userEvents.update(id, locals.user.id, parsed.value, new Date())) {
			error(404, '予定が見つかりません');
		}
		redirect(303, '/app/events?saved=updated');
	},
	/** 共有のリンクを作り直す。前のリンクは使えなくなる */
	rotate: ({ locals, params }) => {
		if (!locals.user) redirect(303, '/login');
		const id = parseId(params['id']);
		if (id === null || !getServices().userEvents.rotateShareToken(id, locals.user.id)) {
			error(404, '共有のリンクが見つかりません');
		}
		return { message: '共有のリンクを作り直しました。前のリンクは、使えなくなりました。' };
	},
	delete: ({ locals, params }) => {
		if (!locals.user) redirect(303, '/login');
		const id = parseId(params['id']);
		if (id === null || !getServices().userEvents.delete(id, locals.user.id)) {
			error(404, '予定が見つかりません');
		}
		redirect(303, '/app/events?saved=deleted');
	},
};
