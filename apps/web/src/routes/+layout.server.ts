import type { ServerLoad } from '@sveltejs/kit';
import { formatJstDateTime } from '#lib/server/invites.ts';
import { getServices } from '#lib/server/services.ts';
import { describeUserAgent } from '#lib/server/user-agent.ts';

export const load: ServerLoad = ({ locals, request }) => ({
	// 画面に渡すのは、表示に要るものだけにする (ID は渡さない。権限は、管理画面へのリンクを出すかどうかだけ)
	user: locals.user ? { email: locals.user.email, isAdmin: locals.user.role === 'admin' } : null,
	theme: locals.theme,
	// フッターに出す、版とクライアントの情報 (不具合の報告に使う)
	about: aboutInfo(request.headers.get('user-agent')),
	// セルフホストの運営者の情報。設定されていなければ null (Issue #109)
	operator: getServices().operator,
});

function aboutInfo(userAgent: string | null) {
	const { build } = getServices();
	return {
		build: build && {
			version: build.version,
			commit: build.commit,
			buildNumber: build.buildNumber,
			builtAt: formatJstDateTime(new Date(build.builtAt)),
		},
		client: describeUserAgent(userAgent),
	};
}
