import { describe, expect, it } from 'vitest';
import { createApi } from './app.ts';
import { errorPageHtml } from './error-page.ts';

const HTML = { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' };

describe('Hono のエラー', () => {
	it('ブラウザ (HTML を求める) には、状態の番号の猫の付いたエラーの画面を返す', async () => {
		const api = createApi({ checkHealth: () => true });
		const res = await api.request('/api/no-such-thing', { headers: HTML });
		expect(res.status).toBe(404);
		expect(res.headers.get('Content-Type')).toMatch(/^text\/html; charset=utf-8$/i);
		const body = await res.text();
		expect(body).toContain('ページが見つかりません');
		expect(body).toContain('https://http.cat/404.jpg');
	});

	it('HTML を求めないもの (カレンダーアプリなど) には、文字だけを返す', async () => {
		const api = createApi({ checkHealth: () => true });
		const res = await api.request('/api/no-such-thing', { headers: { Accept: '*/*' } });
		expect(res.status).toBe(404);
		expect(await res.text()).toBe('Not Found');
	});

	it('処理の途中の例外は 500 にし、内部の情報を出さない', async () => {
		const errors: string[] = [];
		const api = createApi({
			checkHealth: () => {
				throw new Error('ignored');
			},
			onError: (error) => errors.push(error.message),
		});
		api.get('/boom', () => {
			throw new Error('SQLITE_READONLY: /var/lib/funmary/funmary.db');
		});
		const res = await api.request('/boom', { headers: HTML });
		expect(res.status).toBe(500);
		const body = await res.text();
		expect(body).toContain('サーバーでエラーが起きました');
		expect(body).toContain('https://http.cat/500.jpg');
		expect(body).not.toContain('funmary.db');
		expect(errors).toEqual(['SQLITE_READONLY: /var/lib/funmary/funmary.db']);
	});
});

describe('errorPageHtml', () => {
	it('状態の番号は数だけを埋め込み、noindex を付ける', () => {
		const html = errorPageHtml(403);
		expect(html).toContain('<meta name="robots" content="noindex">');
		expect(html).toContain('このページは表示できません');
		expect(html).toContain('https://http.cat/403.jpg');
	});
});
