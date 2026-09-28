// 管理の入口は、設定の画面の「管理」の節にまとめた。前の URL は、そこへ転送する
import { redirect, type ServerLoad } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin.ts';

export const load: ServerLoad = ({ locals }) => {
	requireAdmin(locals);
	redirect(308, '/app/settings#admin');
};
