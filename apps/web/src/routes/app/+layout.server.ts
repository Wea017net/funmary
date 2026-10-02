// アプリの画面 (/app の下) は、ログインしている人だけが使う
import { redirect, type ServerLoad } from '@sveltejs/kit';
import { getServices } from '$lib/server/services.ts';

export const load: ServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	// 上部のベルに出す未読数 (設計書 14.2)
	return { unreadNotifications: getServices().notifications.unreadCount(locals.user.id) };
};
