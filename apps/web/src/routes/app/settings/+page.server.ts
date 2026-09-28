// 設定の画面。全員が使う項目の下に、管理者にだけ「管理」の節を出す
import { redirect, type ServerLoad } from '@sveltejs/kit';
import { loadAdminSummary } from '$lib/server/admin-summary.ts';
import { getServices } from '$lib/server/services.ts';

export const load: ServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	return {
		admin: locals.user.role === 'admin' ? loadAdminSummary(getServices(), new Date()) : null,
	};
};
