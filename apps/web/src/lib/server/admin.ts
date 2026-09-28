import { error, redirect } from '@sveltejs/kit';
import type { AuthUser } from '@funmary/db';

/**
 * 管理画面 (/app/admin) の load と action の最初に呼ぶ。管理者でなければ、画面があることを見せないよう 404 にする。
 * action の前には layout の load が動かないので、layout だけに頼らず、個々の load と action で呼ぶ
 */
export function requireAdmin(locals: { readonly user: AuthUser | null }): AuthUser {
	if (!locals.user) redirect(303, '/login');
	if (locals.user.role !== 'admin') error(404, 'Not Found');
	return locals.user;
}
