// みんなの予定 (Issue #145)。全体に公開された予定 (自分の予定を除く) を探す。持ち主の情報は出さない。
import { type ServerLoad } from '@sveltejs/kit';
import { summarizeEvent } from '#lib/server/event-summary.ts';
import { getServices } from '#lib/server/services.ts';
import { requireSignedIn } from '#lib/server/admin.ts';

export const load: ServerLoad = ({ locals }) => {
	requireSignedIn(locals);
	return {
		events: getServices()
			.userEvents.listPublic(locals.user.id)
			.map((shared) => ({ ...summarizeEvent(shared.event), subscribed: shared.subscribed })),
	};
};
