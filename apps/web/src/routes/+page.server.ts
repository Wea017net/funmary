import type { ServerLoad } from '@sveltejs/kit';

export const load: ServerLoad = ({ locals }) => ({
	// 画面に渡すのは、表示に要るものだけにする (ID は渡さない。権限は、管理画面へのリンクを出すかどうかだけ)
	user: locals.user ? { email: locals.user.email, isAdmin: locals.user.role === 'admin' } : null,
});
