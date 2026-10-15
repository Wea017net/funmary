// アプリの画面 (/app の下) は、ログインしている人だけが使う
import { type ServerLoad } from '@sveltejs/kit';
import { getServices } from '#lib/server/services.ts';
import { requireSignedIn } from '#lib/server/admin.ts';

export const load: ServerLoad = ({ locals }) => {
	requireSignedIn(locals);
	const services = getServices();
	// 上部のベルに出す未読数と、バスのタブを出すか (BUS_API_BASE_URL を設定したときだけ)
	return {
		unreadNotifications: services.notifications.unreadCount(locals.user.id),
		busEnabled: services.bus !== null,
	};
};
