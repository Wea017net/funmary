import { describe, expect, it } from 'vitest';
import type { AuthUser, UserRole } from '@funmary/db';
import { changeRole, changeStatus, formatUserList, parseRole } from './user-admin.ts';

function fakeStore(initial: AuthUser[]) {
	const users = new Map(initial.map((user) => [user.id, { ...user }]));
	return {
		users,
		findUserByEmail: (email: string) =>
			[...users.values()].find((user) => user.email.toLowerCase() === email.toLowerCase()) ?? null,
		setRole: (id: string, role: UserRole) => {
			users.set(id, { ...users.get(id)!, role });
		},
		setStatus: (id: string, status: 'active' | 'suspended') => {
			users.set(id, { ...users.get(id)!, status });
		},
	};
}

const taro: AuthUser = {
	id: 'u1',
	email: 'taro@fun.ac.jp',
	name: null,
	role: 'user',
	status: 'active',
};

describe('権限の段階の指定', () => {
	it('user、moderator、admin だけを受け付ける', () => {
		expect(parseRole('moderator')).toBe('moderator');
		expect(parseRole('ADMIN')).toBe('admin');
		expect(parseRole('owner')).toBeNull();
	});
});

describe('権限の段階を変える', () => {
	it('メールアドレスで探して変え、前と後を返す', () => {
		const store = fakeStore([taro]);
		expect(changeRole(store, 'Taro@fun.ac.jp', 'moderator', [])).toEqual({
			kind: 'changed',
			user: { ...taro, role: 'moderator' },
			from: 'user',
		});
		expect(store.users.get('u1')?.role).toBe('moderator');
	});

	it('見つからなければ not-found、同じ段階なら unchanged で、何も書き換えない', () => {
		const store = fakeStore([taro]);
		expect(changeRole(store, 'none@fun.ac.jp', 'admin', []).kind).toBe('not-found');
		expect(changeRole(store, 'taro@fun.ac.jp', 'user', []).kind).toBe('unchanged');
	});

	it('ADMIN_EMAILS にある人を管理者から下げると、次のログインで管理者に戻ることを知らせる', () => {
		const store = fakeStore([{ ...taro, role: 'admin' }]);
		expect(changeRole(store, 'taro@fun.ac.jp', 'user', ['TARO@fun.ac.jp'])).toMatchObject({
			kind: 'changed',
			adminEmail: true,
		});
	});
});

describe('利用の停止と再開', () => {
	it('停止と再開を切り替える。同じ状態なら unchanged', () => {
		const store = fakeStore([taro]);
		expect(changeStatus(store, 'taro@fun.ac.jp', 'suspended').kind).toBe('changed');
		expect(store.users.get('u1')?.status).toBe('suspended');
		expect(changeStatus(store, 'taro@fun.ac.jp', 'suspended').kind).toBe('unchanged');
		expect(changeStatus(store, 'none@fun.ac.jp', 'active').kind).toBe('not-found');
	});
});

describe('利用者の一覧', () => {
	it('メールアドレス、段階、状態、権限を 1 行ずつ出す', () => {
		expect(
			formatUserList([
				{ id: 'u1', email: 'taro@fun.ac.jp', role: 'moderator', status: 'active', permissions: [] },
				{
					id: 'u2',
					email: 'hanako@fun.ac.jp',
					role: 'user',
					status: 'suspended',
					permissions: ['invite:create'],
				},
			]),
		).toEqual([
			'taro@fun.ac.jp  モデレーター',
			'hanako@fun.ac.jp  一般  停止中  権限: invite:create',
			'2 人 (管理者 0、モデレーター 1、一般 1、停止中 1)',
		]);
	});
});
