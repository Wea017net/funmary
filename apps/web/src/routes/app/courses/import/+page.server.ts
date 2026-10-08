// 学生ポータルの時間割からの取り込み。ブックマークレットが、読み取った内容を URL の # 以降に入れてこの画面を開く。
// 画面の JavaScript が # 以降をフォームに入れ、利用者がボタンを押したときだけ送る (リンクを開いただけでは取り込まない)。
import { fail, redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import { buildBookmarklet, buildImportScript, decodeImportFragment } from '@funmary/sources';
import { getServices } from '#lib/server/services.ts';
import { alertSlotConflicts } from '#lib/server/slot-conflicts.ts';

export const load: ServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	const { origin } = getServices();
	return { bookmarklet: buildBookmarklet(origin), script: buildImportScript(origin) };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		const form = await request.formData();
		const payload = form.get('payload');
		if (typeof payload !== 'string' || payload === '') {
			return fail(400, {
				error:
					'取り込む内容がありません。ポータルの時間割のページで、ブックマークレットを押してください。',
			});
		}
		const decoded = decodeImportFragment(payload);
		if (decoded.kind === 'invalid') {
			return fail(400, {
				error: `内容を読めませんでした (${decoded.reason})。もう一度、ブックマークレットを押してください。`,
			});
		}

		const services = getServices();
		const result = services.courses.importFromPortal(
			locals.user.id,
			decoded.cells.map((cell) => ({
				lessonId: cell.lessonId,
				year: cell.year,
				weekday: cell.weekday,
				period: cell.period,
				room: cell.room,
				hopeUrl: cell.hopeUrl,
			})),
			new Date(),
		);
		await alertSlotConflicts(services, result.conflicts);
		return {
			result: {
				read: decoded.cells.length,
				rejected: decoded.rejected,
				registered: result.registered,
				slotsAdded: result.slotsAdded,
				slotsUpdated: result.slotsUpdated,
				unknown: result.unknown.length,
				conflicts: result.conflicts.length,
			},
		};
	},
};
