// 管理用コマンドの user (設計書 19.4) の判断の部分。利用者をメールアドレスで探し、権限の段階と、利用の停止を変える
import type { AuthStore, AuthUser, UserRole, UserSummary } from '@funmary/db';

export const ROLE_LABELS: Readonly<Record<UserRole, string>> = {
	admin: '管理者',
	moderator: 'モデレーター',
	user: '一般',
};

export function parseRole(value: string): UserRole | null {
	const role = value.toLowerCase();
	return role === 'user' || role === 'moderator' || role === 'admin' ? role : null;
}

export type UserChange<T> =
	| { readonly kind: 'not-found' }
	| { readonly kind: 'unchanged'; readonly user: AuthUser }
	| { readonly kind: 'changed'; readonly user: AuthUser; readonly from: T };

type RoleStore = Pick<AuthStore, 'findUserByEmail' | 'setRole'>;
type StatusStore = Pick<AuthStore, 'findUserByEmail' | 'setStatus'>;

/**
 * adminEmail が true なら、ADMIN_EMAILS にある人を管理者から下げた。
 * ログインのたびに管理者に戻るので、ADMIN_EMAILS からも外す必要がある
 */
export function changeRole(
	store: RoleStore,
	email: string,
	role: UserRole,
	adminEmails: readonly string[],
): UserChange<UserRole> & { readonly adminEmail?: boolean } {
	const user = store.findUserByEmail(email);
	if (!user) return { kind: 'not-found' };
	if (user.role === role) return { kind: 'unchanged', user };
	store.setRole(user.id, role);
	const adminEmail =
		role !== 'admin' &&
		adminEmails.some((admin) => admin.toLowerCase() === user.email.toLowerCase());
	return {
		kind: 'changed',
		user: { ...user, role },
		from: user.role,
		...(adminEmail && { adminEmail }),
	};
}

/** 停止すると、その人のセッションもすべて消える (AuthStore.setStatus) */
export function changeStatus(
	store: StatusStore,
	email: string,
	status: 'active' | 'suspended',
): UserChange<'active' | 'suspended'> {
	const user = store.findUserByEmail(email);
	if (!user) return { kind: 'not-found' };
	if (user.status === status) return { kind: 'unchanged', user };
	store.setStatus(user.id, status);
	return { kind: 'changed', user: { ...user, status }, from: user.status };
}

export function formatUserList(users: readonly UserSummary[]): string[] {
	const lines = users.map((user) =>
		[
			user.email,
			ROLE_LABELS[user.role],
			...(user.status === 'suspended' ? ['停止中'] : []),
			...(user.permissions.length > 0 ? [`権限: ${user.permissions.join('、')}`] : []),
		].join('  '),
	);
	const count = (role: UserRole) => users.filter((user) => user.role === role).length;
	const suspended = users.filter((user) => user.status === 'suspended').length;
	lines.push(
		`${users.length} 人 (管理者 ${count('admin')}、モデレーター ${count('moderator')}、一般 ${count('user')}、停止中 ${suspended})`,
	);
	return lines;
}
