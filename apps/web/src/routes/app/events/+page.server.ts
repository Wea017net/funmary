// 自分の予定の一覧 (Issue #144、#145)。自分が足した予定と、ほかの人の予定のうち自分の時間割に加えたもの。
import { type ServerLoad } from '@sveltejs/kit';
import { summarizeEvent } from '#lib/server/event-summary.ts';
import { getServices } from '#lib/server/services.ts';
import { requireSignedIn } from '#lib/server/admin.ts';

const VISIBILITY_LABELS = { private: '自分だけ', link: '限定公開', public: '全体に公開' } as const;

export const load: ServerLoad = ({ locals, url }) => {
	requireSignedIn(locals);
	const { userEvents } = getServices();
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
		events: userEvents.listByOwner(locals.user.id).map((event) => ({
			...summarizeEvent(event),
			visibility: VISIBILITY_LABELS[event.visibility],
		})),
		// 加えた予定は、持ち主が非公開にしていれば出ない。開くのは、予定の番号で (公開されているものだけ)
		subscribed: userEvents.listSubscribed(locals.user).map(summarizeEvent),
	};
};
