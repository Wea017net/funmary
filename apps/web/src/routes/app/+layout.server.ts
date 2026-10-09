// アプリの画面 (/app の下) は、ログインしている人だけが使う
import { type ServerLoad } from '@sveltejs/kit';
import { getServices } from '#lib/server/services.ts';
import { requireSignedIn } from '#lib/server/admin.ts';

export const load: ServerLoad = ({ locals }) => {
	requireSignedIn(locals);
	// 上部のベルに出す未読数
	return { unreadNotifications: getServices().notifications.unreadCount(locals.user.id) };
};
