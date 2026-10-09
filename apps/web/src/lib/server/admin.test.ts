import { isHttpError, isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { requireAdmin, requireSignedIn } from './admin.ts';

const user = (role: 'user' | 'admin') =>
	({
		id: 'u1',
		email: 'u1@fun.ac.jp',
		name: null,
		role,
		status: 'active',
		termsAcceptedVersion: null,
	}) as const;

function thrown(fn: () => unknown): unknown {
	try {
		fn();
	} catch (error) {
		return error;
	}
	throw new Error('例外になるはず');
}

describe('requireSignedIn', () => {
	it('ログインしていれば、何もしない', () => {
		expect(() => requireSignedIn({ user: user('user') })).not.toThrow();
	});

	it('ログインしていなければ、ログインの画面に移す', () => {
		const error = thrown(() => requireSignedIn({ user: null }));
		expect(isRedirect(error) && error.location).toBe('/login');
	});
});

describe('requireAdmin', () => {
	it('管理者なら、その利用者を返す', () => {
		expect(requireAdmin({ user: user('admin') })).toEqual(user('admin'));
	});

	it('ログインしていなければ、ログインの画面に移す', () => {
		const error = thrown(() => requireAdmin({ user: null }));
		expect(isRedirect(error) && error.location).toBe('/login');
	});

	it('管理者でなければ、画面があることを見せないよう 404 にする', () => {
		const error = thrown(() => requireAdmin({ user: user('user') }));
		expect(isHttpError(error) && error.status).toBe(404);
	});
});
