// 紹介の画面。ログインしているかどうかにかかわらず出す。アプリは /app の下にある。
import type { ServerLoad } from '@sveltejs/kit';
import { getServices } from '#lib/server/services.ts';

export const load: ServerLoad = ({ locals }) => ({
	signedIn: locals.user !== null,
	registration: getServices().registration,
});
