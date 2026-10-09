// フォームの送信の Origin の検査。SvelteKit の組み込みの検査を切って (svelte.config の trustedOrigins)、同じ検査をここで行う。
// 組み込みの検査は、Origin のない form の POST をすべて断る。OAuth のトークンの口には、claude.ai などのサーバーが
// Origin なしで form を送ってくるので、その口だけは通す。Cookie では認証しない口なので、CSRF の心配はない。

/** Origin がなくても通す口。Cookie を使わず、クライアントのサーバーから直接呼ばれる */
const SERVER_TO_SERVER_PATHS: ReadonlySet<string> = new Set(['/oauth/token']);

const MUTATING_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const FORM_CONTENT_TYPES = [
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/plain',
];

export function isCsrfForbidden(input: {
	readonly method: string;
	readonly path: string;
	readonly contentType: string | null;
	readonly origin: string | null;
	readonly selfOrigin: string;
}): boolean {
	if (!MUTATING_METHODS.has(input.method)) return false;
	if (SERVER_TO_SERVER_PATHS.has(input.path)) return false;
	const isForm =
		!input.contentType ||
		FORM_CONTENT_TYPES.some((type) => input.contentType?.toLowerCase().startsWith(type));
	return isForm && input.origin !== input.selfOrigin;
}
