// リポジトリと、運営者へのリンク
import { redirect, type ServerLoad } from '@sveltejs/kit';
import { getServices } from '$lib/server/services.ts';

export const load: ServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	return { operator: getServices().operator };
};
