// アプリの画面 (/app の下) は、ログインしている人だけが使う
import { redirect, type ServerLoad } from '@sveltejs/kit';
import { loadInviteStatus } from '$lib/server/invites.ts';
import { getServices } from '$lib/server/services.ts';

export const load: ServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	// 招待コードを発行できる人 (今月の上限に達した人も含む) にだけ、メニューに招待を出す
	const { issuance } = loadInviteStatus(getServices(), locals.user, new Date());
	return { canInvite: issuance.kind !== 'not-allowed' };
};
