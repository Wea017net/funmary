// アプリの画面 (/app の下) は、ログインしている人だけが使う
import { redirect, type ServerLoad } from '@sveltejs/kit';

export const load: ServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
};
