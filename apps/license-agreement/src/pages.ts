// 同意の画面。html の中に埋め込む値は、hono/html が自動でエスケープする
import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { AGREEMENT_POINTS } from './agreement.ts';

type Page = HtmlEscapedString | Promise<HtmlEscapedString>;

function layout(title: string, body: Page): Page {
	return html`<!doctype html>
		<html lang="ja">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta name="robots" content="noindex" />
				<title>${title} - Funmary</title>
				<style>
					:root {
						color-scheme: light dark;
						--text: #1f1b1b;
						--muted: #625b5b;
						--background: #ffffff;
						--primary: #9d2126;
						--surface: #f6eeee;
					}
					@media (prefers-color-scheme: dark) {
						:root {
							--text: #e6e1e1;
							--muted: #b3abab;
							--background: #141212;
							--primary: #d6999e;
							--surface: #262222;
						}
					}
					body {
						margin: 0;
						background: var(--background);
						color: var(--text);
						font-family: system-ui, sans-serif;
						line-height: 1.7;
					}
					main {
						box-sizing: border-box;
						max-width: 40rem;
						margin: 0 auto;
						padding: 2rem 1rem;
					}
					h1 {
						font-size: 1.5rem;
					}
					.muted {
						color: var(--muted);
						font-size: 0.875rem;
					}
					.points {
						padding: 1rem 1rem 1rem 2rem;
						border-radius: 0.75rem;
						background: var(--surface);
					}
					.button {
						display: inline-flex;
						align-items: center;
						min-height: 44px;
						padding: 0 1.25rem;
						border: 0;
						border-radius: 0.5rem;
						background: #9d2126;
						color: #ffffff;
						font: inherit;
						font-weight: 700;
						text-decoration: none;
						cursor: pointer;
					}
					a {
						color: var(--primary);
					}
				</style>
			</head>
			<body>
				<main>${body}</main>
			</body>
		</html>`;
}

function points(repoUrl: string): Page {
	return html`<ol class="points">
			${AGREEMENT_POINTS.map((point) => html`<li>${point}</li>`)}
		</ol>
		<p class="muted">
			ライセンスの本文:
			<a href="${repoUrl}/blob/main/LICENSE-BSD-3-CLAUSE" target="_blank" rel="noopener noreferrer"
				>BSD-3-Clause</a
			>、
			<a href="${repoUrl}/blob/main/LICENSE-APACHE-2.0" target="_blank" rel="noopener noreferrer"
				>Apache-2.0</a
			>、
			<a href="${repoUrl}/blob/main/LICENSE-ASSETS" target="_blank" rel="noopener noreferrer"
				>ロゴとアイコンの利用条件</a
			>
		</p>`;
}

export function agreePage(input: { repo: string; loginUrl: string }): Page {
	const repoUrl = `https://github.com/${input.repo}`;
	return layout(
		'ライセンスへの同意',
		html`<h1>ライセンスへの同意</h1>
			<p>
				${input.repo} に変更を送る前に、次の内容に同意してください。同意は 1 人 1 回で、次の PR
				からは聞きません (内容を変えたときは、もう一度お願いします)。
			</p>
			${points(repoUrl)}
			<p>
				<a class="button" href="${input.loginUrl}">GitHub でログインして、次へ</a>
			</p>
			<p class="muted">
				ログインは、だれが同意したかを確かめるためだけに使います。GitHub
				のユーザー名と ID、同意した日時を記録します。
			</p>`,
	);
}

export function confirmPage(input: { repo: string; login: string; token: string }): Page {
	return layout(
		'ライセンスへの同意',
		html`<h1>ライセンスへの同意</h1>
			<p>@${input.login} として、次の内容に同意します。</p>
			${points(`https://github.com/${input.repo}`)}
			<form method="post" action="/agree">
				<input type="hidden" name="token" value="${input.token}" />
				<button class="button" type="submit">同意する</button>
			</form>`,
	);
}

export function donePage(input: { repo: string; login: string; updated: number }): Page {
	return layout(
		'同意しました',
		html`<h1>同意しました</h1>
			<p>@${input.login} さんの同意を記録しました。ありがとうございます。</p>
			<p>
				${input.updated > 0
					? `開いている PR (${input.updated} 件) の検査「ライセンスへの同意」を通しました。`
					: '次に PR を開くと、検査「ライセンスへの同意」がすぐ通ります。'}
			</p>
			<p>
				<a href="https://github.com/${input.repo}/pulls" rel="noopener noreferrer"
					>${input.repo} の PR に戻る</a
				>
			</p>`,
	);
}

export function errorPage(message: string): Page {
	return layout('エラー', html`<h1>エラー</h1><p>${message}</p>`);
}
