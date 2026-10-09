import { error, redirect } from '@sveltejs/kit';
import type { AuthUser } from '@funmary/db';

/**
 * ログインしている人だけの画面や操作の、load と action の最初に呼ぶ。ログインしていなければ、ログインの画面へ移す。
 * 呼んだあと、locals.user は null でないものとして扱える (TypeScript の型が絞られる)。
 * action の前には layout の load が動かないので、layout だけに頼らず、個々の load と action で呼ぶ
 */
export function requireSignedIn(locals: {
	readonly user: AuthUser | null;
}): asserts locals is { readonly user: AuthUser } {
	if (!locals.user) redirect(303, '/login');
}

/**
 * 管理画面 (/app/admin) の load と action の最初に呼ぶ。管理者でなければ、画面があることを見せないよう 404 にする。
 * action の前には layout の load が動かないので、layout だけに頼らず、個々の load と action で呼ぶ
 */
export function requireAdmin(locals: { readonly user: AuthUser | null }): AuthUser {
	if (!locals.user) redirect(303, '/login');
	if (locals.user.role !== 'admin') error(404, 'Not Found');
	return locals.user;
}

/**
 * moderator と admin の両方に開く画面や操作 (監査ログ、曜日と時限の確認待ちなど) の、load と action の最初に呼ぶ。
 * admin だけに絞りたいときは requireAdmin を使う
 */
export function requireModerator(locals: { readonly user: AuthUser | null }): AuthUser {
	if (!locals.user) redirect(303, '/login');
	if (locals.user.role !== 'admin' && locals.user.role !== 'moderator') error(404, 'Not Found');
	return locals.user;
}
