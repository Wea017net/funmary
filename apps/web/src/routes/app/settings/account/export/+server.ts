// アカウントのデータの書き出し (JSON のダウンロード)。トークンなどの秘密は入れない。
import { error, type RequestHandler } from '@sveltejs/kit';
import { requireSignedIn } from '#lib/server/admin.ts';
import { getServices } from '#lib/server/services.ts';

export const GET: RequestHandler = ({ locals }) => {
	requireSignedIn(locals);
	const now = new Date();
	const data = getServices().account.exportData(locals.user.id, now);
	if (!data) error(404, 'Not Found');
	return new Response(JSON.stringify(data, null, 2), {
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'content-disposition': `attachment; filename="funmary-data-${now.toISOString().slice(0, 10)}.json"`,
			'cache-control': 'no-store',
		},
	});
};
