// アカウントの管理。データの書き出しと、退会。
import { sessionCookieName } from '@funmary/api';
import { fail, redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import { requireSignedIn } from '#lib/server/admin.ts';
import { getServices } from '#lib/server/services.ts';

export const load: ServerLoad = ({ locals }) => {
	requireSignedIn(locals);
	return { email: locals.user.email };
};

export const actions: Actions = {
	delete: async ({ request, locals, cookies }) => {
		requireSignedIn(locals);
		const form = await request.formData();
		// 押し間違いで消えないよう、メールアドレスを打ってもらう
		const entered = form.get('email');
		const typed = typeof entered === 'string' ? entered.trim().toLowerCase() : '';
		if (typed !== locals.user.email.toLowerCase()) {
			return fail(400, { error: 'メールアドレスが一致しません。' });
		}
		const services = getServices();
		services.account.deleteAccount(locals.user.id);
		void services.alertAdmin({
			severity: 'info',
			title: '利用者が退会しました',
			category: 'users',
			key: `user-deleted:${Date.now()}`,
		});
		cookies.delete(sessionCookieName(services.origin), { path: '/' });
		redirect(303, '/');
	},
};
