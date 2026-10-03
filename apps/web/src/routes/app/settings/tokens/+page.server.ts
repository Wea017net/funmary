// 公開 API と MCP サーバー向けの個人用アクセストークン (設計書 3.3)。発行、一覧、無効化。
// トークンは発行したときに 1 回だけ見せ、DB にはハッシュだけを保存する。
import { fail, redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import {
	ACCESS_TOKEN_EXPIRES_OPTIONS,
	ACCESS_TOKEN_SCOPE_OPTIONS,
	parseAccessTokenId,
	parseAccessTokenIssue,
} from '$lib/server/access-token-form.ts';
import { getServices } from '$lib/server/services.ts';

export const load: ServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	const { accessTokens, origin } = getServices();
	const now = new Date();
	return {
		tokens: accessTokens.list(locals.user.id, now).map((token) => ({
			id: token.id,
			name: token.name,
			scopes: token.scopes,
			expiresAt: token.expiresAt.toISOString(),
			createdAt: token.createdAt.toISOString(),
			lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
		})),
		scopeOptions: ACCESS_TOKEN_SCOPE_OPTIONS,
		expiresOptions: ACCESS_TOKEN_EXPIRES_OPTIONS,
		apiBase: `${origin}/api/v1`,
		docsUrl: `${origin}/api/docs`,
		mcpUrl: `${origin}/mcp`,
	};
};

export const actions: Actions = {
	issue: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		const { accessTokens } = getServices();
		const now = new Date();
		const parsed = parseAccessTokenIssue(await request.formData(), now);
		if (!parsed.ok) return fail(400, { error: parsed.error });
		const token = accessTokens.issue(
			locals.user.id,
			{ name: parsed.name, scopes: parsed.scopes },
			parsed.expiresAt,
			now,
		);
		return { message: `「${parsed.name}」を発行しました。`, token };
	},

	revoke: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		const { accessTokens } = getServices();
		const id = parseAccessTokenId(await request.formData());
		if (id === null) return fail(400, { error: '指定が正しくありません。' });
		const revoked = accessTokens.revoke(locals.user.id, id, new Date());
		if (!revoked) return fail(400, { error: '見つかりませんでした。' });
		return { message: '無効にしました。' };
	},
};
