// ほかの人の予定を見て、自分の時間割に加える、外す (Issue #145)。
// ref は、限定公開の共有のリンクの値か、全体に公開された予定の番号。開けるかは、ストアが決める。持ち主の情報は出さない。
import { error, fail, redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import { summarizeEvent } from '$lib/server/event-summary.ts';
import { getServices } from '$lib/server/services.ts';

export const load: ServerLoad = ({ locals, params }) => {
	if (!locals.user) redirect(303, '/login');
	const shared = getServices().userEvents.findShared(params['ref'] ?? '', locals.user);
	if (!shared) error(404, '予定が見つかりません');
	return {
		event: summarizeEvent(shared.event),
		isOwner: shared.isOwner,
		subscribed: shared.subscribed,
	};
};

export const actions: Actions = {
	/** 自分の時間割に加える。見られない予定は、加えられない */
	subscribe: ({ locals, params }) => {
		if (!locals.user) redirect(303, '/login');
		const { userEvents } = getServices();
		const shared = userEvents.findShared(params['ref'] ?? '', locals.user);
		if (!shared) error(404, '予定が見つかりません');
		if (shared.isOwner) return fail(400, { error: '自分の予定は、加えなくても、時間割に出ます。' });
		userEvents.subscribe(locals.user, shared.event.id, new Date());
		return { message: '自分の時間割に加えました。' };
	},
	unsubscribe: ({ locals, params }) => {
		if (!locals.user) redirect(303, '/login');
		const { userEvents } = getServices();
		const shared = userEvents.findShared(params['ref'] ?? '', locals.user);
		if (!shared) error(404, '予定が見つかりません');
		userEvents.unsubscribe(locals.user.id, shared.event.id);
		return { message: '自分の時間割から外しました。' };
	},
};
