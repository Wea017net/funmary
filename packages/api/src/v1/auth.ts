// /api/v1 の認証。Authorization: Bearer <トークン> を検証し、持ち主と範囲を c に置く。
// Cookie では認証しないので、CSRF の心配はない。
import type { AccessTokenScope, AccessTokenStore } from '@funmary/db';
import { createMiddleware } from 'hono/factory';

export interface V1AuthVariables {
	readonly tokenOwner: { readonly userId: string; readonly scopes: readonly AccessTokenScope[] };
}

export interface V1AuthDeps {
	readonly accessTokens: Pick<AccessTokenStore, 'findOwner' | 'markUsed'>;
}

const BEARER = /^Bearer\s+(\S+)$/;

/** Authorization ヘッダのトークンを確かめ、持ち主を c.var.tokenOwner に置く。なければ 401 */
export function v1Auth(deps: V1AuthDeps) {
	return createMiddleware<{ Variables: V1AuthVariables }>(async (c, next) => {
		const header = c.req.header('Authorization') ?? '';
		const match = BEARER.exec(header);
		const token = match?.[1];
		if (!token) {
			return c.json(
				{ error: 'unauthorized', message: 'Authorization: Bearer <token> が要ります' },
				401,
			);
		}
		const now = new Date();
		const owner = deps.accessTokens.findOwner(token, now);
		if (!owner) {
			return c.json({ error: 'unauthorized', message: 'トークンが無効です' }, 401);
		}
		deps.accessTokens.markUsed(owner.id, now);
		c.set('tokenOwner', { userId: owner.userId, scopes: owner.scopes });
		await next();
	});
}

/** 範囲 (scope) が足りなければ 403 */
export function requireScope(scope: AccessTokenScope) {
	return createMiddleware<{ Variables: V1AuthVariables }>(async (c, next) => {
		const owner = c.get('tokenOwner');
		if (!owner.scopes.includes(scope)) {
			return c.json(
				{ error: 'insufficient_scope', message: `このトークンには ${scope} の範囲がありません` },
				403,
			);
		}
		await next();
	});
}
