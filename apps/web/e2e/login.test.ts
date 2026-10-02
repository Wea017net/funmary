// Google のログインの通し (設計書 21 章)。Google の代わりに、テスト用の OpenID Connect のサーバーを使う。
// サーバーは本物の RS256 で署名した ID トークンを返すので、アプリは本番と同じ手順 (PKCE、state、nonce、署名の検証) を通る。
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createCourseStore, createSubjectStore, openDatabase, type Database } from '@funmary/db';
import {
	startMockOidcServer,
	type MockOidcServer,
} from '../../../packages/auth/src/testing/mock-oidc-server.ts';
import { REPOSITORY_URL } from '../src/lib/repository.ts';
import { E2E_DATA_DIR } from '../e2e-data-dir.ts';
import { OIDC_PORT } from '../oidc-port.ts';

// サーバーの状態 (次にログインする人) を共有するので、テストは 1 つずつ動かす
test.describe.configure({ mode: 'serial' });

let oidc: MockOidcServer;

test.beforeAll(async () => {
	mkdirSync(E2E_DATA_DIR, { recursive: true });
	oidc = await startMockOidcServer({
		clientId: 'e2e.apps.googleusercontent.com',
		clientSecret: 'e2e-client-secret',
		port: OIDC_PORT,
		// 失敗したテストのやり直しでは、新しいワーカーがこのサーバーを立て直す。アプリは前の公開鍵を覚えているので、
		// 鍵が変わると ID トークンの検証に失敗し、以降のログインがすべて落ちる。立て直しても同じ鍵を使う
		keyFile: join(E2E_DATA_DIR, 'mock-oidc-key.pem'),
	});
});

test.afterAll(async () => {
	await oidc.close();
});

test.afterEach(() => {
	oidc.tamper('none');
});

test('ログインしていないと、トップページにログインへのリンクが出る', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('link', { name: '大学のアカウントではじめる' })).toBeVisible();
});

test('共有したときのカード (OGP) の情報を出し、画像は絶対 URL で配る', async ({
	page,
	request,
}) => {
	await page.goto('/');
	const image = await page.locator('meta[property="og:image"]').getAttribute('content');
	expect(image).toMatch(/^https?:\/\/[^/]+\/brand\/og-image\.png$/);
	await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Funmary');
	await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
		'content',
		'summary_large_image',
	);
	const response = await request.get(new URL(image ?? '').pathname);
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toBe('image/png');
});

test('ロゴとアイコンを /brand で配り、決まった名前のほかは返さない', async ({ request, page }) => {
	for (const [name, type] of [
		['logo-light.svg', 'image/svg+xml'],
		['icon.svg', 'image/svg+xml'],
		['icon-dark.svg', 'image/svg+xml'],
		['og-image.png', 'image/png'],
	]) {
		const response = await request.get(`/brand/${name}`);
		expect(response.status(), name).toBe(200);
		expect(response.headers()['content-type']).toBe(type);
	}
	expect((await request.get('/brand/secret.txt')).status()).toBe(404);

	await page.goto('/');
	await expect(page.getByRole('link', { name: 'Funmary' }).first()).toBeVisible();
});

test.describe('ホーム画面に追加 (PWA)', () => {
	test('マニフェストとアイコンを配る', async ({ request }) => {
		const manifest = await request.get('/manifest.webmanifest');
		expect(manifest.status()).toBe(200);
		expect(manifest.headers()['content-type']).toContain('manifest+json');
		const body = (await manifest.json()) as { icons: { src: string }[] };
		expect(body).toMatchObject({ start_url: '/app', scope: '/app', display: 'standalone' });
		for (const icon of [
			...body.icons.map((i: { src: string }) => i.src),
			'/brand/apple-touch-icon.png',
		]) {
			const response = await request.get(icon);
			expect(response.status(), icon).toBe(200);
			expect(response.headers()['content-type']).toBe('image/png');
		}
	});

	test('ブラウザで開くと、ホームに追加のやり方を出し、追加したアプリで開くと出さない。折りたたむと、次に開いたときも折りたたんだまま', async ({
		browser,
	}) => {
		const email = 'e2e-pwa@fun.ac.jp';
		const login = async (page: import('@playwright/test').Page) => {
			oidc.setIdentity({ sub: email, email, email_verified: true, hd: 'fun.ac.jp' });
			await page.goto('/auth/google');
			await expect(page).toHaveURL('/app');
		};

		const browserPage = await (await browser.newContext()).newPage();
		await login(browserPage);
		const heading = browserPage.getByRole('heading', { name: 'アプリとして使う' });
		await expect(heading).toBeVisible();
		await expect(browserPage.getByText('プッシュ通知は、今後対応する予定')).toBeVisible();

		// 折りたたむと、開き直しても折りたたんだまま (このブラウザだけ覚える)
		await heading.click();
		await expect(browserPage.getByText('プッシュ通知は、今後対応する予定')).toBeHidden();
		await browserPage.reload();
		await expect(browserPage.getByRole('heading', { name: 'アプリとして使う' })).toBeVisible();
		await expect(browserPage.getByText('プッシュ通知は、今後対応する予定')).toBeHidden();

		// iOS のホーム画面のアプリは、navigator.standalone が true になる
		const context = await browser.newContext();
		await context.addInitScript(() => {
			Object.defineProperty(navigator, 'standalone', { value: true });
		});
		const installedPage = await context.newPage();
		await login(installedPage);
		await expect(installedPage.getByRole('heading', { name: 'ホーム', exact: true })).toBeVisible();
		await expect(installedPage.getByRole('heading', { name: 'アプリとして使う' })).toHaveCount(0);
	});
});

test('大学のアカウントでログインでき、ログアウトできる', async ({ page }) => {
	oidc.setIdentity({
		sub: 'e2e-taro',
		email: 'taro@fun.ac.jp',
		email_verified: true,
		hd: 'fun.ac.jp',
		name: '山田 太郎',
	});
	await page.goto('/login');
	await page.getByRole('link', { name: 'Google でログイン' }).click();

	await expect(page).toHaveURL('/app');
	// メールアドレスの @ より前は、押すまで出さない
	const menu = page.getByRole('navigation', { name: 'メニュー' });
	await expect(menu).toContainText('••••••••@fun.ac.jp');
	await expect(menu).not.toContainText('taro@');
	await menu.getByRole('button', { name: 'メールアドレスを表示する' }).click();
	await expect(menu.getByText('taro@fun.ac.jp')).toBeVisible();
	await menu.getByRole('button', { name: 'メールアドレスを隠す' }).click();
	await expect(menu).not.toContainText('taro@');

	// セッションは HttpOnly の Cookie で、画面の JavaScript から読めない
	const cookies = await page.context().cookies();
	const session = cookies.find((c) => c.name === 'funmary_session');
	expect(session?.httpOnly).toBe(true);
	expect(session?.sameSite).toBe('Lax');
	expect(await page.evaluate(() => document.cookie)).not.toContain('funmary_session');

	// ログイン済みなら、ログインの画面は開かず、アプリに移る
	await page.goto('/login');
	await expect(page).toHaveURL('/app');

	// 紹介の画面は、ログインしていても見られ、アプリへの入口を出す
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(
		'大学の「知りたい」を、すべて。',
	);
	await page.getByRole('link', { name: 'アプリを開く' }).click();
	await expect(page).toHaveURL('/app');

	// ログアウトは、メニューではなく、設定の中にある
	await expect(menu.getByRole('button', { name: 'ログアウト' })).toHaveCount(0);
	await page.goto('/app/settings');
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'ログアウト' }).click();
	await expect(page).toHaveURL('/');
	await expect(page.getByRole('link', { name: '大学のアカウントではじめる' })).toBeVisible();
	expect((await page.context().cookies()).some((c) => c.name === 'funmary_session')).toBe(false);
});

test('大学のアカウントでなければ、ログインできず、理由が出る', async ({ page }) => {
	oidc.setIdentity({ sub: 'e2e-outsider', email: 'someone@example.com', email_verified: true });
	await page.goto('/auth/google');
	await expect(page).toHaveURL(/\/login\?error=/);
	await expect(page.getByRole('alert')).toContainText('大学');
	expect((await page.context().cookies()).some((c) => c.name === 'funmary_session')).toBe(false);
});

test('署名の合わない ID トークンは、受け付けない', async ({ page }) => {
	oidc.setIdentity({
		sub: 'e2e-forged',
		email: 'forged@fun.ac.jp',
		email_verified: true,
		hd: 'fun.ac.jp',
	});
	oidc.tamper('wrong-key');
	await page.goto('/auth/google');
	await expect(page).toHaveURL('/login?error=invalid-callback');
	await expect(page.getByRole('alert')).toBeVisible();
	expect((await page.context().cookies()).some((c) => c.name === 'funmary_session')).toBe(false);
});

test('ログインの途中の Cookie がなければ、やり直しになる', async ({ page }) => {
	await page.goto('/auth/google/callback?code=x&state=y');
	await expect(page).toHaveURL('/login?error=flow-expired');
});

test('知らない理由を URL に書いても、画面には何も出ない', async ({ page }) => {
	await page.goto('/login?error=%3Cscript%3Ealert(1)%3C/script%3E');
	await expect(page.getByRole('alert')).toHaveCount(0);
});

test.describe('ポータルの時間割の取り込み', () => {
	const loginAs = async (page: import('@playwright/test').Page) => {
		oidc.setIdentity({
			sub: 'e2e-import',
			email: 'import@fun.ac.jp',
			email_verified: true,
			hd: 'fun.ac.jp',
		});
		await page.goto('/auth/google');
		await expect(page).toHaveURL('/app');
	};

	test('ログインしていなければ、ログインの画面に移る', async ({ page }) => {
		await page.goto('/app/courses/import');
		await expect(page).toHaveURL('/login');
	});

	test('使い方と、自動では取れないため利用者どうしで登録している旨、ブックマークレットを出す', async ({
		page,
	}) => {
		await loginAs(page);
		await page.goto('/app/courses/import');
		await expect(page.getByText('大学から自動では取得できません')).toBeVisible();
		const link = page.getByRole('link', { name: 'Funmary に時間割を取り込む' });
		await expect(link).toHaveAttribute('href', /^javascript:/);
	});

	test('# 以降の内容は、ボタンを押したときだけ送り、結果を出す。URL からは内容を消す', async ({
		page,
	}) => {
		await loginAs(page);
		const payload = Buffer.from(
			JSON.stringify({
				v: 1,
				c: [
					{
						l: '999999',
						y: 2026,
						t: '20',
						w: 1,
						p: 1,
						r: '595',
						s: '',
						n: '架空の科目',
						h: '',
						x: '',
					},
				],
			}),
		).toString('base64url');
		await page.goto(`/app/courses/import#${payload}`);
		await expect(page.getByRole('button', { name: '取り込む' })).toBeVisible();
		expect(new URL(page.url()).hash).toBe('');
		await page.getByRole('button', { name: '取り込む' }).click();
		await expect(page.getByText('読み取ったコマ: 1 件')).toBeVisible();
		// まだシラバスを取り込んでいない科目は、登録しない
		await expect(page.getByText('まだ Funmary に取り込まれていない科目: 1 件')).toBeVisible();
	});

	test('壊れた内容は、取り込まずに理由を出す', async ({ page }) => {
		await loginAs(page);
		await page.goto('/app/courses/import#AAAA');
		await page.getByRole('button', { name: '取り込む' }).click();
		await expect(page.getByRole('alert')).toContainText('内容を読めませんでした');
	});

	test('前の URL (/courses/import) で開いても、# 以降を残したまま /app の下へ転送する', async ({
		page,
	}) => {
		// 登録済みのブックマークレットは、前の URL を開く
		await loginAs(page);
		await page.goto('/courses/import#AAAA');
		await expect(page).toHaveURL('/app/courses/import');
		await page.getByRole('button', { name: '取り込む' }).click();
		await expect(page.getByRole('alert')).toContainText('内容を読めませんでした');
	});
});

/** テストのサーバーと同じ DB を開いて架空の科目を入れ (何度入れても同じになる)、演習の科目の ID と DB を fn に渡す */
function seedSubjects<T>(fn: (database: Database, exerciseId: number) => T): T {
	const database = openDatabase(join(E2E_DATA_DIR, 'funmary.db'), {
		backupDir: join(E2E_DATA_DIR, 'backups'),
	});
	try {
		const subjects = createSubjectStore(database);
		const base = {
			academicYear: 2026,
			credits: 2,
			attributes: {},
			syllabus: {},
			syllabusUrl: null,
		};
		const exerciseId = subjects.upsert(
			{
				...base,
				syllabusId: '900001',
				name: '架空の演習Ⅱ1-AB',
				teacher: '架空 一郎',
				term: 'fall',
				attributes: { 配当年次: '2年' },
				syllabus: { 授業の概要: '架空の演習の概要です。' },
				syllabusUrl: 'https://syllabus.example.com/900001',
			},
			new Date(),
		);
		subjects.upsert(
			{ ...base, syllabusId: '900002', name: '架空の講義', teacher: null, term: 'q3' },
			new Date(),
		);
		return fn(database, exerciseId);
	} finally {
		database.close();
	}
}

// Google の代わりのサーバーを 1 つのポートで立てるので、ログインが要る画面のテストもこのファイルに置く
test.describe('履修科目の登録', () => {
	// 手元では DB がテストのたびに消えないので、利用者を毎回変えて、前回の登録を持ち越さない
	const sub = `e2e-courses-${Date.now()}`;

	test.beforeAll(() => {
		seedSubjects((database, exerciseId) => {
			// 前回の実行で足した枠を消し、休講を 1 件入れておく (科目との照合は、済んだものとして入れる)
			database.sqlite.prepare('DELETE FROM timetable_slots WHERE subject_id = ?').run(exerciseId);
			database.sqlite
				.prepare(
					`INSERT OR IGNORE INTO class_changes
						(kind, subject_id, lesson_name, date, period, makeup_plan, first_seen_at, last_seen_at)
						VALUES ('cancellation', ?, '架空の演習Ⅱ1-AB', '2026-10-06', 3, 'planned', 0, 0)`,
				)
				.run(exerciseId);
		});
	});

	const loginAs = async (page: import('@playwright/test').Page) => {
		oidc.setIdentity({ sub, email: `${sub}@fun.ac.jp`, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		await expect(page).toHaveURL('/app');
	};

	test('ログインしていなければ、ログインの画面に移る', async ({ page }) => {
		await page.goto('/app/courses');
		await expect(page).toHaveURL('/login');
	});

	test('科目を探して登録し、曜日と時限を足し、登録を取り消せる', async ({ page }) => {
		await loginAs(page);
		await page
			.getByRole('navigation', { name: 'メニュー' })
			.getByRole('link', { name: '科目', exact: true })
			.click();
		await expect(page.getByText('まだ登録していません')).toBeVisible();

		// 「科目を探す」はタブで切り替える。開いたタブは URL に残り、読み込み直しても保たれる
		await page.getByRole('tab', { name: '科目を探す' }).click();
		await expect(page).toHaveURL(/tab=search/);
		// ローマ数字を II と打っても見つかる
		await page.getByRole('searchbox').fill('架空の演習II');
		await page.getByRole('button', { name: '探す' }).click();
		const found = page.getByRole('tabpanel', { name: '科目を探す' }).getByRole('listitem');
		await expect(found).toHaveCount(1);
		await expect(found).toContainText('後期、架空 一郎');
		await found.getByRole('button', { name: '登録する' }).click();
		await expect(page.getByRole('status')).toHaveText('架空の演習Ⅱ1-AB を履修科目に登録しました。');

		await page.getByRole('tab', { name: '登録した科目' }).click();
		const registered = page
			.getByRole('tabpanel', { name: '登録した科目' })
			.getByRole('listitem')
			.filter({ hasText: '架空の演習Ⅱ1-AB' });
		await expect(registered).toContainText('曜日と時限が、まだ登録されていません');

		await registered.getByText('曜日と時限を登録する', { exact: true }).click();
		const addSlot = registered.locator('details[open]');
		await addSlot.getByLabel('曜日').selectOption('火曜');
		await addSlot.getByLabel('時限').selectOption('3 限');
		await addSlot.getByLabel('教室').fill(' 363 ');
		await addSlot.getByRole('button', { name: '登録する' }).click();
		await expect(page.getByRole('status')).toHaveText('曜日と時限を登録しました。');
		await expect(registered).toContainText('火曜 3 限、363');

		// 授業の詳細
		await registered.getByRole('link', { name: '架空の演習Ⅱ1-AB' }).click();
		// 授業の URL は、DB の ID でなく、年度とシラバスの番号で作る
		await expect(page).toHaveURL('/app/subjects/2026/900001');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('架空の演習Ⅱ1-AB');
		await expect(page.getByText('2026 年度 後期')).toBeVisible();
		await expect(page.getByText('火曜 3 限、363')).toBeVisible();
		const changes = page.getByRole('region', { name: '休講、補講、教室変更' });
		await expect(changes).toContainText('休講 2026-10-06 3 限、補講あり');
		await expect(page.getByText('架空の演習の概要です。')).toBeVisible();
		const syllabusLink = page.getByRole('link', { name: 'シラバスの原文 (大学のサイト)' });
		await expect(syllabusLink).toHaveAttribute('href', 'https://syllabus.example.com/900001');
		// Funmary の外へのリンクは、新しいタブで開く
		await expect(syllabusLink).toHaveAttribute('target', '_blank');
		await expect(syllabusLink).toHaveAttribute('rel', 'noopener noreferrer');
		await page
			.getByRole('navigation', { name: 'メニュー' })
			.getByRole('link', { name: '科目', exact: true })
			.click();

		page.once('dialog', (dialog) => dialog.accept());
		await registered.getByRole('button', { name: '登録を取り消す' }).click();
		await expect(page.getByRole('status')).toHaveText('架空の演習Ⅱ1-AB の登録を取り消しました。');
		await expect(page.getByText('まだ登録していません')).toBeVisible();
	});

	test('シラバスにない授業を足して登録でき、足した人は直したり消したりできる', async ({
		page,
		browser,
	}) => {
		// E2E の DB は実行をまたいで残るので、実行ごとに別の名前にする
		const name = `E2E の課外講座${Date.now()}`;
		await loginAs(page);
		await page.goto('/app/courses');
		const create = page.getByRole('region', { name: 'シラバスにない授業を足す' });
		await create.getByText('公開シラバスに載っていない授業を、科目として足す').click();
		await create.getByLabel(/授業の名前/).fill(name);
		await create.getByLabel('学期').selectOption('後期');
		await create.getByRole('button', { name: '足して登録する' }).click();
		await expect(page.getByRole('status')).toContainText(
			`${name} を足して、履修科目に登録しました`,
		);
		const registered = page
			.getByRole('tabpanel', { name: '登録した科目' })
			.getByRole('listitem')
			.filter({ hasText: name });
		await expect(registered).toContainText('シラバスにない授業');

		// 同じ名前 (全角と半角の違いを除く) は足さない
		await create.getByLabel(/授業の名前/).fill(name.replace('E2E', 'Ｅ２Ｅ'));
		await create.getByRole('button', { name: '足して登録する' }).click();
		await expect(page.getByRole('alert')).toContainText(`同じ名前の科目「${name}」があります`);

		// ほかの利用者は探して登録できるが、直せない
		const other = await (await browser.newContext()).newPage();
		const otherEmail = `e2e-other-${Date.now()}@fun.ac.jp`;
		oidc.setIdentity({ sub: otherEmail, email: otherEmail, email_verified: true, hd: 'fun.ac.jp' });
		await other.goto('/auth/google');
		await other.goto(`/app/courses?q=${encodeURIComponent(name)}`);
		await other.getByRole('link', { name }).click();
		await expect(other.getByText('公開シラバスにない授業です。')).toBeVisible();
		await expect(other.getByRole('region', { name: 'この授業を直す' })).toHaveCount(0);

		// 直せなくても、履修登録していなくても、曜日と時限は足せる
		await other.getByText('曜日と時限を足す', { exact: true }).click();
		const addSlot = other.locator('details[open]');
		await addSlot.getByLabel('曜日').selectOption('水曜');
		await addSlot.getByLabel('時限').selectOption('2 限');
		await addSlot.getByRole('button', { name: '登録する' }).click();
		await expect(other.getByRole('status')).toHaveText('曜日と時限を登録しました。');
		await expect(other.getByText('水曜 2 限')).toBeVisible();

		// 足した人は直せる
		await registered.getByRole('link', { name }).click();
		const edit = page.getByRole('region', { name: 'この授業を直す' });
		await edit.getByLabel('教員 (任意)').fill('未来 花子');
		await edit.getByRole('button', { name: '直す' }).click();
		await expect(page.getByRole('status')).toHaveText('授業を直しました。');
		await expect(page.getByText('未来 花子')).toBeVisible();

		// 消すときは、確かめたことのチェックが要る
		await edit.getByText('この授業を消す').click();
		await edit.getByLabel(/元に戻せないことを確かめました/).check();
		await edit.getByRole('button', { name: '消す' }).click();
		await expect(page).toHaveURL('/app/courses');
		await expect(page.getByRole('link', { name })).toHaveCount(0);
	});

	test('シラバスにない授業の公開範囲を変えられる。非公開は足した人と管理者だけ、限定公開は URL を知っていれば見られる', async ({
		page,
		browser,
	}) => {
		const name = `E2E の公開範囲演習${Date.now()}`;
		await loginAs(page);
		await page.goto('/app/courses');
		const create = page.getByRole('region', { name: 'シラバスにない授業を足す' });
		await create.getByText('公開シラバスに載っていない授業を、科目として足す').click();
		await create.getByLabel(/授業の名前/).fill(name);
		await create.getByLabel('学期').selectOption('後期');
		await create.getByRole('button', { name: '足して登録する' }).click();
		await expect(page.getByRole('status')).toContainText(`${name} を足して`);

		const registered = page
			.getByRole('tabpanel', { name: '登録した科目' })
			.getByRole('listitem')
			.filter({ hasText: name });
		await registered.getByRole('link', { name }).click();
		const visibility = page.getByRole('group', { name: '公開範囲' });
		await expect(visibility).toBeVisible();
		const subjectUrl = page.url();

		const other = await (await browser.newContext()).newPage();
		const otherEmail = `e2e-visibility-${Date.now()}@fun.ac.jp`;
		oidc.setIdentity({ sub: otherEmail, email: otherEmail, email_verified: true, hd: 'fun.ac.jp' });
		await other.goto('/auth/google');

		// 既定 (全体公開) では、ほかの利用者も探して見つけられる
		await other.goto(`/app/courses?q=${encodeURIComponent(name)}`);
		await expect(other.getByRole('link', { name })).toBeVisible();

		// 非公開にすると、ほかの利用者は探しても見つからず、直接開いても見つからないと出る
		await visibility.getByLabel(/非公開/).check();
		await page.getByRole('button', { name: '公開範囲を変える' }).click();
		await expect(page.getByRole('status')).toHaveText('公開範囲を 非公開 に変えました。');
		await other.goto(`/app/courses?q=${encodeURIComponent(name)}`);
		await expect(other.getByRole('link', { name })).toHaveCount(0);
		expect((await other.goto(subjectUrl))?.status()).toBe(404);

		// 限定公開にすると、探しては見つからないが、URL を知っていれば直接開ける
		await page.goto(subjectUrl);
		await visibility.getByLabel(/限定公開/).check();
		await page.getByRole('button', { name: '公開範囲を変える' }).click();
		await expect(page.getByRole('status')).toHaveText('公開範囲を 限定公開 に変えました。');
		await other.goto(`/app/courses?q=${encodeURIComponent(name)}`);
		await expect(other.getByRole('link', { name })).toHaveCount(0);
		expect((await other.goto(subjectUrl))?.status()).toBe(200);
	});

	test('ない科目の詳細は、見つからないと出す', async ({ page }) => {
		await loginAs(page);
		// 授業の URL は /app/subjects/<年度>/<シラバスの番号>。前の形 (DB の ID) は転送しない
		for (const path of ['2026/999999', '26/900001', '2026/..%2Fx', '1']) {
			const response = await page.goto(`/app/subjects/${path}`);
			expect(response?.status()).toBe(404);
		}
	});
});

test.describe('スマホの幅で、画面が横にはみ出さない', () => {
	test('主な画面を、スマホの幅 (390px) で開いても、横スクロールが出ない', async ({ page }) => {
		const email = `e2e-overflow-${Date.now()}@fun.ac.jp`;
		oidc.setIdentity({ sub: email, email, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		await expect(page).toHaveURL('/app');
		await page.setViewportSize({ width: 390, height: 844 });

		seedSubjects(() => {});

		const paths = [
			'/',
			'/app',
			'/app/week',
			'/app/courses',
			'/app/courses/import',
			'/app/subjects/2026/900001',
			'/app/events',
			'/app/events/browse',
			'/app/settings',
			'/app/settings/calendar',
			'/app/settings/discord',
			'/app/settings/invites',
			'/about',
			'/license',
			'/third-party-licenses',
		];
		for (const path of paths) {
			await page.goto(path);
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			);
			expect(overflow, `${path} が横にはみ出しています`).toBeLessThanOrEqual(1);
		}
	});

	test('管理画面を、スマホの幅 (390px) で開いても、横スクロールが出ない', async ({ page }) => {
		oidc.setIdentity({
			sub: 'e2e-admin@fun.ac.jp',
			email: 'e2e-admin@fun.ac.jp',
			email_verified: true,
			hd: 'fun.ac.jp',
		});
		await page.goto('/auth/google');
		await expect(page).toHaveURL('/app');
		await page.setViewportSize({ width: 390, height: 844 });

		const paths = [
			'/app/admin/lessons',
			'/app/admin/calendar',
			'/app/admin/timetable',
			'/app/admin/invites',
			'/app/admin/status',
			'/app/admin/support-invites',
			'/app/notifications',
			'/app/admin/discord',
			'/app/admin/audit-log',
			'/app/admin/slot-review',
		];
		for (const path of paths) {
			await page.goto(path);
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			);
			expect(overflow, `${path} が横にはみ出しています`).toBeLessThanOrEqual(1);
		}
	});
});

test.describe('管理画面', () => {
	test.beforeAll(() => {
		seedSubjects((database) => {
			// 照合できなかった授業名と、その名前の休講を、紐付け前の状態に戻して入れる
			database.sqlite
				.prepare(
					`INSERT INTO unmatched_lessons (academic_year, lesson_name, first_seen_at, last_seen_at)
						VALUES (2026, '架空の演習Ⅱ (再)', 0, 0)
						ON CONFLICT DO UPDATE SET resolved_subject_id = NULL, ignored_at = NULL`,
				)
				.run();
			database.sqlite
				.prepare(
					`INSERT INTO class_changes (kind, lesson_name, date, period, first_seen_at, last_seen_at)
						VALUES ('cancellation', '架空の演習Ⅱ (再)', '2026-10-13', 2, 0, 0)
						ON CONFLICT DO UPDATE SET subject_id = NULL`,
				)
				.run();
		});
	});

	const loginAs = async (page: import('@playwright/test').Page, email: string) => {
		oidc.setIdentity({ sub: email, email, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		await expect(page).toHaveURL('/app');
	};

	test('管理者でなければ、管理画面は見つからないことにする', async ({ page }) => {
		await loginAs(page, 'e2e-not-admin@fun.ac.jp');
		// 設定は全員が使える。管理の節は出ない
		await page
			.getByRole('navigation', { name: 'メニュー' })
			.getByRole('link', { name: '設定', exact: true })
			.click();
		await expect(page.getByRole('link', { name: /カレンダーの購読/ })).toBeVisible();
		await expect(page.getByRole('region', { name: '管理' })).toHaveCount(0);
		const response = await page.goto('/app/admin/lessons');
		expect(response?.status()).toBe(404);
	});

	test('シラバスにない授業の公開、情報の変更、削除が、操作の記録に残る。管理者でなければ見られない', async ({
		page,
	}) => {
		await loginAs(page, 'e2e-not-admin@fun.ac.jp');
		expect((await page.goto('/app/admin/audit-log'))?.status()).toBe(404);

		await loginAs(page, 'e2e-admin@fun.ac.jp');
		const name = `E2E の監査ログ演習${Date.now()}`;
		await page.goto('/app/courses');
		await page.getByText('公開シラバスに載っていない授業を、科目として足す').click();
		await page.getByLabel(/授業の名前/).fill(name);
		await page.getByLabel('学期').selectOption('後期');
		await page.getByRole('button', { name: '足して登録する' }).click();
		await expect(page.getByRole('status')).toContainText(`${name} を足して`);

		await page.getByRole('link', { name }).click();
		const edit = page.getByRole('region', { name: 'この授業を直す' });
		await edit.getByLabel('教員 (任意)').fill('監査 太郎');
		await edit.getByRole('button', { name: '直す' }).click();
		await expect(page.getByRole('status')).toHaveText('授業を直しました。');
		await edit.getByText('この授業を消す').click();
		await edit.getByLabel(/元に戻せないことを確かめました/).check();
		await edit.getByRole('button', { name: '消す' }).click();
		await expect(page).toHaveURL('/app/courses');

		await page.goto('/app/admin/audit-log');
		const entries = page.getByRole('row');
		await expect(
			entries.filter({ hasText: `${name} を、シラバスにない授業として足した` }),
		).toHaveCount(1);
		await expect(entries.filter({ hasText: `${name} の情報を直した (${name})` })).toHaveCount(1);
		await expect(
			entries.filter({ hasText: `${name} を、シラバスにない授業として消した` }),
		).toHaveCount(1);
		await expect(entries.filter({ hasText: name }).first()).toContainText('e2e-admin@fun.ac.jp');
	});

	test('Discord設定の画面は、管理者にだけ開け、Bot が未設定なら設定のしかたを出す', async ({
		page,
	}) => {
		await loginAs(page, 'e2e-not-admin@fun.ac.jp');
		expect((await page.goto('/app/admin/discord'))?.status()).toBe(404);

		await loginAs(page, 'e2e-admin@fun.ac.jp');
		await page.goto('/app/settings');
		await page.getByRole('link', { name: /^Discord設定/ }).click();
		await expect(page.getByRole('heading', { name: 'Discord設定', level: 1 })).toBeVisible();
		await expect(page.getByText('Bot が設定されていません')).toBeVisible();
		await expect(page.getByRole('navigation', { name: 'パンくず' })).toContainText('設定');
		// チャンネル 7 本とロール 3 つが、まだ決まっていない状態で並ぶ
		await expect(
			page.getByRole('region', { name: 'チャンネル' }).getByRole('listitem'),
		).toHaveCount(7);
		await expect(page.getByRole('region', { name: 'ロール' }).getByRole('listitem')).toHaveCount(3);
		// Bot がないときは、整えるボタンを出さない
		await expect(page.getByRole('button', { name: 'チャンネルとロールを整える' })).toHaveCount(0);
	});

	test('大学の公式の学年暦の PDF へのリンクを、設定に出す', async ({ page }) => {
		const pdf = 'https://www.fun.ac.jp/wp/wp-content/uploads/2026AcademicCalendar.pdf';
		seedSubjects((database) => {
			database.sqlite
				.prepare(
					`INSERT INTO settings (key, value, updated_at) VALUES ('official-academic-calendar-pdf', ?, 0)
						ON CONFLICT DO UPDATE SET value = excluded.value`,
				)
				.run(JSON.stringify({ year: 2026, url: pdf }));
		});
		await loginAs(page, 'e2e-not-admin@fun.ac.jp');
		await page.goto('/app/settings');
		const link = page
			.getByRole('region', { name: '大学の公式の資料' })
			.getByRole('link', { name: '2026 年度の学年暦 (PDF)' });
		await expect(link).toHaveAttribute('href', pdf);
		await expect(link).toHaveAttribute('target', '_blank');
		await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
	});

	test('照合できなかった授業名を、候補の科目に紐付けられる', async ({ page }) => {
		await loginAs(page, 'e2e-admin@fun.ac.jp');
		// 管理者には、設定の中に管理の節が出る。前の管理の入口は、そこへ転送する
		await page.goto('/app/admin');
		await expect(page).toHaveURL('/app/settings#admin');
		// 管理の節は、ふだん使う項目の邪魔にならないよう、アカウント (ログアウト) より下に出す
		const headings = await page.getByRole('heading', { level: 2 }).allTextContents();
		expect(headings.indexOf('管理')).toBeGreaterThan(headings.indexOf('アカウント'));
		await page
			.getByRole('region', { name: '管理' })
			.getByRole('link', { name: /照合できなかった授業名/ })
			.click();

		const lesson = page.getByRole('listitem').filter({ hasText: '架空の演習Ⅱ (再)' });
		await lesson.getByRole('radio', { name: /架空の演習Ⅱ1-AB \(900001、後期\)/ }).check();
		await lesson.getByRole('button', { name: '紐付ける' }).click();
		await expect(page.getByRole('status')).toHaveText(
			'架空の演習Ⅱ (再) を 架空の演習Ⅱ1-AB に紐付けました (休講などの 1 件に科目を入れました)。',
		);
		await expect(page.getByRole('heading', { name: '架空の演習Ⅱ (再)' })).toHaveCount(0);

		// 紐付け済みの一覧に移る。紐付けを外すと、照合できなかった一覧に戻る
		const resolved = page.getByRole('region', { name: '紐付け済み' });
		await expect(resolved).toContainText('架空の演習Ⅱ (再)');
		await expect(resolved.getByRole('link', { name: '架空の演習Ⅱ1-AB' })).toBeVisible();
		await resolved.getByRole('button', { name: '紐付けを外す' }).click();
		await expect(page.getByRole('status')).toHaveText(
			'架空の演習Ⅱ (再) の紐付けを外しました (休講などの 1 件から科目を外しました)。',
		);
		await expect(page.getByRole('heading', { name: '架空の演習Ⅱ (再)' })).toBeVisible();
		await expect(page.getByRole('region', { name: '紐付け済み' })).toHaveCount(0);

		// 科目にしないと、一覧から外れ、あとで戻せる
		await page
			.getByRole('listitem')
			.filter({ hasText: '架空の演習Ⅱ (再)' })
			.getByRole('button', { name: '科目にしない' })
			.click();
		await expect(page.getByRole('heading', { name: '架空の演習Ⅱ (再)' })).toHaveCount(0);
		const ignored = page.getByRole('region', { name: '科目にしない' });
		await expect(ignored).toContainText('架空の演習Ⅱ (再)');
		await ignored
			.getByRole('listitem')
			.filter({ hasText: '架空の演習Ⅱ (再)' })
			.getByRole('button', { name: '一覧に戻す' })
			.click();
		await expect(page.getByRole('heading', { name: '架空の演習Ⅱ (再)' })).toBeVisible();
		await expect(ignored.getByText('架空の演習Ⅱ (再)')).toHaveCount(0);

		// 紐付けと紐付け外しが、操作の記録に残る (E2E の DB は実行をまたいで残るので、0 件でないことだけ確かめる)
		await page.goto('/app/admin/audit-log');
		const entries = page.getByRole('row');
		await expect(
			entries.filter({ hasText: '架空の演習Ⅱ (再) を 架空の演習Ⅱ1-AB に紐付けた' }),
		).not.toHaveCount(0);
		await expect(entries.filter({ hasText: '架空の演習Ⅱ (再) の紐付けを外した' })).not.toHaveCount(
			0,
		);
	});
});

test.describe('曜日と時限の確認', () => {
	const loginAs = async (page: import('@playwright/test').Page, email: string) => {
		oidc.setIdentity({ sub: email, email, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		await expect(page).toHaveURL('/app');
	};

	/** ログイン済みの利用者を、直接 DB でモデレーターにする (昇格の画面はまだない、#15) */
	function promoteToModerator(email: string) {
		const database = openDatabase(join(E2E_DATA_DIR, 'funmary.db'), {
			backupDir: join(E2E_DATA_DIR, 'backups'),
		});
		try {
			database.sqlite.prepare(`UPDATE users SET role = 'moderator' WHERE email = ?`).run(email);
		} finally {
			database.close();
		}
	}

	test('確認して登録する設定にすると提出になり、モデレーターが承認すると共有の枠に入って記録に残る。だれも登録できない設定では、個人用だけ使える', async ({
		page,
		browser,
	}) => {
		const name = `E2E の確認演習${Date.now()}`;
		const moderatorEmail = `e2e-slot-moderator-${Date.now()}@fun.ac.jp`;

		// 管理者が、確認してから登録する設定にする
		await loginAs(page, 'e2e-admin@fun.ac.jp');
		await page.goto('/app/admin/slot-review');
		await page.getByRole('radio', { name: 'モデレーターか管理者が確認してから登録する' }).check();
		await page.getByRole('button', { name: '保存する' }).click();
		await expect(page.getByRole('status')).toHaveText('設定を保存しました。');

		// 利用者が、シラバスにない授業を足して、曜日と時限を提出する
		const otherPage = await (await browser.newContext()).newPage();
		await loginAs(otherPage, `e2e-slot-user-${Date.now()}@fun.ac.jp`);
		await otherPage.goto('/app/courses');
		await otherPage.getByText('公開シラバスに載っていない授業を、科目として足す').click();
		await otherPage.getByLabel(/授業の名前/).fill(name);
		await otherPage.getByLabel('学期').selectOption('後期');
		await otherPage.getByRole('button', { name: '足して登録する' }).click();
		await otherPage.getByRole('tab', { name: '登録した科目' }).click();
		const registered = otherPage
			.getByRole('tabpanel', { name: '登録した科目' })
			.getByRole('listitem')
			.filter({ hasText: name });
		await registered.getByText('曜日と時限を登録する', { exact: true }).click();
		const submitForm = registered.locator('details[open]');
		await submitForm.getByLabel('曜日').selectOption('木曜');
		await submitForm.getByLabel('時限').selectOption('4 限');
		await submitForm.getByRole('button', { name: '登録する' }).click();
		await expect(otherPage.getByRole('status')).toContainText('確かめてから登録されます');
		await expect(registered).toContainText('曜日と時限が、まだ登録されていません');

		// モデレーターが承認する (このリポジトリには、まだ昇格の画面がないので、直接 DB でモデレーターにする)
		await loginAs(page, moderatorEmail);
		promoteToModerator(moderatorEmail);
		await page.goto('/app/admin/slot-review');
		const pending = page
			.getByRole('region', { name: '確認待ち' })
			.getByRole('listitem')
			.filter({ hasText: name });
		await expect(pending).toContainText('木曜 4 限');
		await expect(page.getByRole('radio', { name: /確認してから登録する/ })).toHaveCount(0);
		await pending.getByRole('button', { name: '承認する' }).click();
		await expect(page.getByRole('status')).toHaveText('承認し、共有の枠に登録しました。');

		// 共有の枠に入り、操作の記録にも残る
		await registered.getByRole('link', { name }).click();
		await expect(otherPage.getByText('木曜 4 限')).toBeVisible();
		await page.goto('/app/admin/audit-log');
		await expect(
			page.getByRole('row').filter({ hasText: `${name} の曜日と時限の提出を承認した` }),
		).not.toHaveCount(0);

		// だれも登録できない設定にすると、共有の登録の欄は出ず、個人用だけ使える
		await loginAs(page, 'e2e-admin@fun.ac.jp');
		await page.goto('/app/admin/slot-review');
		await page.getByRole('radio', { name: 'だれも登録できない' }).check();
		await page.getByRole('button', { name: '保存する' }).click();
		await otherPage.goto('/app/courses');
		await otherPage.getByRole('tab', { name: '登録した科目' }).click();
		await expect(registered.getByText('曜日と時限を登録する', { exact: true })).toHaveCount(0);
		await registered.getByText('自分だけに使う曜日と時限を登録する').click();
		const personalForm = registered.locator('details[open]');
		await personalForm.getByLabel('曜日').selectOption('金曜');
		await personalForm.getByLabel('時限').selectOption('1 限');
		await personalForm.getByRole('button', { name: '登録する' }).click();
		await expect(otherPage.getByRole('status')).toHaveText(
			'自分だけに使う曜日と時限を登録しました。',
		);
		await expect(registered).toContainText('金曜 1 限');

		// 元の設定 (だれでも登録できる) に戻す
		await page.getByRole('radio', { name: 'だれでも登録できる' }).check();
		await page.getByRole('button', { name: '保存する' }).click();
	});
});

test.describe('今日と週の時間割', () => {
	// 手元では DB がテストのたびに消えないので、利用者を毎回変える
	const sub = `e2e-week-${Date.now()}`;
	const email = `${sub}@fun.ac.jp`;

	const loginAs = async (page: import('@playwright/test').Page) => {
		oidc.setIdentity({ sub, email, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		await expect(page).toHaveURL('/app');
	};

	/** ログインした利用者に、架空の科目を履修登録し、火曜 3 限の枠と、休講などを入れる */
	const registerSubject = () =>
		seedSubjects((database) => {
			const subjectId = createSubjectStore(database).upsert(
				{
					academicYear: 2026,
					syllabusId: '900003',
					name: '架空の時間割演習',
					teacher: null,
					credits: 2,
					term: 'fall',
					attributes: {},
					syllabus: {},
					syllabusUrl: null,
				},
				new Date(),
			);
			const user = database.sqlite.prepare('SELECT id FROM users WHERE email = ?').get(email) as {
				id: string;
			};
			const courses = createCourseStore(database);
			courses.register(user.id, subjectId, new Date());
			database.sqlite.prepare('DELETE FROM timetable_slots WHERE subject_id = ?').run(subjectId);
			courses.addSharedSlots(
				[{ subjectId, weekday: 2, period: 3, room: '363' }],
				{ source: 'manual', createdBy: user.id },
				new Date(),
			);
			const insertChange = database.sqlite.prepare(
				`INSERT INTO class_changes
					(kind, subject_id, lesson_name, date, period, room, from_room, first_seen_at, last_seen_at)
					VALUES (?, ?, '架空の時間割演習', ?, ?, ?, ?, 0, 0)
					ON CONFLICT DO UPDATE SET subject_id = excluded.subject_id`,
			);
			insertChange.run('roomChange', subjectId, '2026-10-06', 3, '講堂', '363');
			insertChange.run('makeup', subjectId, '2026-10-08', 5, null, null);
		});

	test('ログインしていなければ、週の時間割はログインの画面に移る', async ({ page }) => {
		await page.goto('/app/week');
		await expect(page).toHaveURL('/login');
	});

	test('履修科目がなければ、今日の画面に登録への案内が出る', async ({ page }) => {
		await loginAs(page);
		await expect(page.getByRole('heading', { name: '次の授業' })).toBeVisible();
		await expect(page.getByRole('link', { name: '履修科目を登録する' })).toBeVisible();
		await expect(page.getByText('休講情報をまだ取得していません')).toBeVisible();
	});

	test('幅が狭いときの週の時間割は、曜日を必ず 2 行目に置き、時限の時刻を 2 行にそろえる', async ({
		page,
	}) => {
		await loginAs(page);
		registerSubject();
		await page.setViewportSize({ width: 390, height: 800 });
		await page.goto('/app/week?date=2026-10-07');
		await page.getByRole('button', { name: '週', exact: true }).click();

		const top = async (locator: import('@playwright/test').Locator) =>
			(await locator.boundingBox())?.y ?? Number.NaN;
		const dates = page.locator('thead .date');
		const weekdays = page.locator('thead .weekday');
		await expect(weekdays).toHaveCount(5);
		for (let i = 0; i < 5; i++) {
			expect(await top(weekdays.nth(i))).toBeGreaterThan((await top(dates.nth(i))) + 8);
		}
		// 各限に時刻が出て、「開始-」と「終了」が別の行になる
		const time = page.locator('tbody .time').first();
		await expect(time).toBeVisible();
		expect(await top(time.locator('.end'))).toBeGreaterThan(
			(await top(time.locator('.start'))) + 8,
		);
	});

	test('週の時間割に、教室変更と補講を文字で出し、補講の仮の教室を示す', async ({ page }) => {
		await loginAs(page);
		registerSubject();
		await page.getByRole('link', { name: '時間割', exact: true }).click();
		await expect(page).toHaveURL('/app/week');

		await page.goto('/app/week?date=2026-10-07');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('10/5 (月) からの週');
		const table = page.getByRole('table');
		await expect(table.getByRole('columnheader')).toHaveText([
			'時限',
			'10/5 (月)',
			'10/6 (火)',
			'10/7 (水)',
			'10/8 (木)',
			'10/9 (金)',
		]);
		const third = table
			.getByRole('row')
			.filter({ has: page.getByRole('rowheader', { name: /^3 限/ }) });
		await expect(third).toContainText('架空の時間割演習');
		await expect(third).toContainText('教室変更');
		await expect(third).toContainText('講堂');
		const fifth = table
			.getByRole('row')
			.filter({ has: page.getByRole('rowheader', { name: /^5 限/ }) });
		await expect(fifth).toContainText('補講');
		await expect(fifth).toContainText('363 (仮。ふだんの教室)');

		// 次の週の月曜 (2026-10-12) はスポーツの日
		await page.getByRole('link', { name: '次の週' }).click();
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('10/12 (月) からの週');
		const holiday = table.getByRole('columnheader', { name: /10\/12 \(月\)/ });
		await expect(holiday).toContainText('祝日');
		await expect(holiday).toContainText('スポーツの日');

		// 週は日曜から土曜なので、日曜の日付は次の月曜からの週になる
		await page.goto('/app/week?date=2026-10-11');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('10/12 (月) からの週');

		// カレンダーで日付を選ぶと、その日を含む週に移る
		await page.getByRole('button', { name: 'カレンダーで日付を選んで、その週を出す' }).click();
		await page.locator('.picker input[type="date"]').fill('2026-11-04');
		await expect(page).toHaveURL('/app/week?date=2026-11-04');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('11/2 (月) からの週');
		for (let i = 0; i < 3; i++) await page.getByRole('link', { name: '前の週' }).click();
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('10/12 (月) からの週');

		await table.getByRole('link', { name: '架空の時間割演習' }).first().click();
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('架空の時間割演習');
	});

	test('画面の色は、自動、ライト、ダークの順に切り替わり、読み込み直しても保たれる', async ({
		page,
	}) => {
		await loginAs(page);
		const html = page.locator('html');
		const toggle = page
			.getByRole('navigation', { name: 'メニュー' })
			.getByRole('button', { name: /^画面の色/ });
		await expect(html).toHaveAttribute('data-theme', 'system');
		await expect(toggle).toHaveAccessibleName('画面の色: 自動 (押すとライトに切り替えます)');
		await toggle.click();
		await expect(html).toHaveAttribute('data-theme', 'light');
		await toggle.click();
		await expect(html).toHaveAttribute('data-theme', 'dark');
		await page.reload();
		await expect(html).toHaveAttribute('data-theme', 'dark');
		await expect(page.locator('body')).toHaveCSS('color', 'rgb(230, 225, 225)');
		await toggle.click();
		await expect(html).toHaveAttribute('data-theme', 'system');
		expect((await page.context().cookies()).some((c) => c.name === 'fm-theme')).toBe(false);
	});

	test('ボタンは、表示や状態が変わっても、押せる範囲の大きさと位置を変えない', async ({ page }) => {
		await loginAs(page);
		const menu = page.getByRole('navigation', { name: 'メニュー' });
		const toggle = menu.getByRole('button', { name: /^画面の色/ });
		const show = menu.getByRole('button', { name: /^メールアドレスを/ });

		// 画面の色のボタンは、表示名が変わっても同じ大きさ
		const first = await toggle.boundingBox();
		for (let i = 0; i < 3; i++) {
			await toggle.click();
			expect(await toggle.boundingBox()).toEqual(first);
		}

		// メールアドレスを表示しても、ボタンの位置とアドレスの欄の大きさは変わらない
		const address = menu.locator('.masked-email');
		const hidden = await show.boundingBox();
		const hiddenAddress = await address.boundingBox();
		await show.click();
		expect(await show.boundingBox()).toEqual(hidden);
		expect(await address.boundingBox()).toEqual(hiddenAddress);

		// 今週と次の週で、次の週のボタンの位置は変わらない
		await page.goto('/app/week');
		const next = page.getByRole('link', { name: '次の週' });
		const thisWeek = await next.boundingBox();
		await next.click();
		await expect(page).toHaveURL(/date=/);
		expect(await next.boundingBox()).toEqual(thisWeek);

		// スマホの幅では、上部の画面の色のボタンは 48px 四方
		await page.setViewportSize({ width: 412, height: 915 });
		const header = page.getByRole('banner');
		const box = await header.getByRole('button', { name: /^画面の色/ }).boundingBox();
		expect([box?.width, box?.height]).toEqual([48, 48]);
	});

	test('ログアウトは、設定の画面にあり、PC のメニューとスマホの上部からは外れている', async ({
		page,
	}) => {
		await loginAs(page);
		await expect(
			page
				.getByRole('navigation', { name: 'メニュー' })
				.getByRole('button', { name: 'ログアウト' }),
		).toHaveCount(0);
		await expect(page.getByRole('banner').getByRole('button', { name: 'ログアウト' })).toHaveCount(
			0,
		);
		await page.goto('/app/settings');
		await expect(page.getByRole('region', { name: 'アカウント' })).toContainText('ログアウト');
	});

	test('週の時間割の見せ方は、狭い画面では自動で 1 日ずつ、選べば週を並べ、読み込み直しても保たれる', async ({
		page,
	}) => {
		await loginAs(page);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/app/week?date=2026-10-07');
		const views = page.getByRole('group', { name: '時間割の見せ方' });
		const auto = views.getByRole('button', { name: '自動' });
		const day = views.getByRole('button', { name: '1日' });
		const week = views.getByRole('button', { name: '週', exact: true });
		const headers = page.getByRole('columnheader', { name: /^\d+\/\d+ \(.\)/ });
		const inView = async (index: number) => {
			const box = await headers.nth(index).boundingBox();
			return box !== null && box.x >= 0 && box.x + box.width <= (page.viewportSize()?.width ?? 0);
		};

		// 自動は、狭い画面では 1 日ずつ。月曜だけが画面に入る
		await expect(auto).toHaveAttribute('aria-pressed', 'true');
		expect(await inView(0)).toBe(true);
		expect(await inView(4)).toBe(false);

		// 週にすると、月曜から金曜が画面に収まる。ボタンの大きさと位置は変わらない
		const before = await day.boundingBox();
		await week.click();
		await expect(week).toHaveAttribute('aria-pressed', 'true');
		expect(await day.boundingBox()).toEqual(before);
		for (let i = 0; i < 5; i++) expect(await inView(i)).toBe(true);

		// 読み込み直しても保たれる。1 日ずつを選べば、広い画面でも 1 日ずつになる
		await page.reload();
		await expect(week).toHaveAttribute('aria-pressed', 'true');
		await page.setViewportSize({ width: 1280, height: 900 });
		for (let i = 0; i < 5; i++) expect(await inView(i)).toBe(true);
		await day.click();
		await expect(day).toHaveAttribute('aria-pressed', 'true');
		await page.setViewportSize({ width: 390, height: 844 });
		expect(await inView(4)).toBe(false);
		await auto.click();
		await page.reload();
		await expect(auto).toHaveAttribute('aria-pressed', 'true');
	});

	test('1 日ずつの見せ方では、今週を開いたとき今日の列が画面に入る', async ({ page }) => {
		// 日曜と土曜は、授業がなければ列がないので、平日だけ確かめる
		const weekday = new Date(Date.now() + 9 * 3600_000).getUTCDay();
		test.skip(weekday === 0 || weekday === 6, '今日が週末だと、今日の列がない');
		await loginAs(page);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/app/week');
		const today = page.locator('thead th.today');
		await expect(today).toBeVisible();
		await expect
			.poll(async () => {
				const box = await today.boundingBox();
				return box !== null && box.x >= 0 && box.x + box.width <= 390;
			})
			.toBe(true);
	});

	test('時間割の取り込みは、ブックマークに登録する方法と、コンソールで実行する方法を選べる', async ({
		page,
	}) => {
		await loginAs(page);
		await page.goto('/app/courses/import');
		const methods = page.getByRole('group', { name: '取り込みの方法' });
		const bookmark = methods.getByRole('button', { name: 'ブックマークに登録する' });
		const console_ = methods.getByRole('button', { name: 'コンソールで実行する' });

		await expect(bookmark).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByRole('link', { name: 'Funmary に時間割を取り込む' })).toBeVisible();

		const before = await bookmark.boundingBox();
		await console_.click();
		await expect(console_).toHaveAttribute('aria-pressed', 'true');
		expect(await bookmark.boundingBox()).toEqual(before);
		await expect(page.getByRole('textbox', { name: '取り込みのコード' })).toHaveValue(
			/^\(function\(\)\{[\s\S]*students\.fun\.ac\.jp/,
		);
		await expect(page.getByRole('button', { name: 'コードをコピーする' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Funmary に時間割を取り込む' })).toBeHidden();
	});

	test('暦にない日付の週は、今週に移る', async ({ page }) => {
		await loginAs(page);
		await page.goto('/app/week?date=2026-02-30');
		await expect(page).toHaveURL('/app/week');
	});
});

test.describe('学年暦の管理', () => {
	test.beforeAll(() => {
		// 手元では DB が残るので、前回入れた学年暦を消しておく
		seedSubjects((database) => {
			database.sqlite.prepare('DELETE FROM academic_terms WHERE academic_year = 2026').run();
			database.sqlite
				.prepare("DELETE FROM academic_days WHERE date BETWEEN '2026-04-01' AND '2027-03-31'")
				.run();
		});
	});

	const loginAsAdmin = async (page: import('@playwright/test').Page) => {
		const email = 'e2e-admin@fun.ac.jp';
		oidc.setIdentity({ sub: email, email, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		await expect(page).toHaveURL('/app');
	};

	test('管理者でなければ、学年暦の画面は見つからないことにする', async ({ page }) => {
		const email = 'e2e-not-admin@fun.ac.jp';
		oidc.setIdentity({ sub: email, email, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		const response = await page.goto('/app/admin/calendar');
		expect(response?.status()).toBe(404);
	});

	test('学期の期間、振替授業日、全学の休講日を入れて消せる。入れた値は時間割に使われる', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto('/app/settings');
		await expect(page.getByText('推定のままです')).toBeVisible();
		await page.goto('/app/admin/calendar?year=2026');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('2026 年度の学年暦');

		const terms = page.getByRole('region', { name: '学期の期間' });
		await expect(terms.getByRole('row', { name: /^後期/ })).toContainText('推定');

		// 日付の欄のフォームは畳んである
		await terms.getByText('日付を入れて学期の期間を入力する').click();
		// 始まりが終わりより後なら、理由を出して保存しない
		await terms.getByLabel('学期').selectOption('後期');
		await terms.getByLabel('始まりの日').fill('2027-01-22');
		await terms.getByLabel('終わりの日 (最後の授業日)').fill('2027-01-21');
		await terms.getByRole('button', { name: '学期の期間を保存する' }).click();
		await expect(page.getByRole('alert')).toHaveText(
			'始まりの日は、終わりの日より前にしてください',
		);

		await terms.getByLabel('始まりの日').fill('2026-09-24');
		await terms.getByRole('button', { name: '学期の期間を保存する' }).click();
		await expect(page.getByRole('status')).toHaveText('学期の期間を保存しました。');
		const fall = terms.getByRole('row', { name: /^後期/ });
		await expect(fall).toContainText('2026-09-24 から 2027-01-21');
		await expect(fall).toContainText('手入力');
		await expect(terms.getByRole('row', { name: /^3Q/ })).toContainText('後期と同じ期間');

		// 振替授業日と全学の休講日は、1 年の暦で日を押して入れる
		const year = page.getByRole('region', { name: '1 年の暦' });
		const dialog = page.getByRole('dialog');
		await year.getByRole('button', { name: /^10月14日 \(水\)/ }).click();
		await expect(dialog.getByRole('heading', { level: 3 })).toHaveText('2026年10月14日 (水)');
		await expect(dialog).toContainText('学期: 通年、後期、3Q');
		await dialog.getByLabel('行う授業の曜日').selectOption('月曜');
		await dialog.getByRole('button', { name: '振替授業日にする' }).click();
		await expect(page.getByRole('status')).toHaveText('振替授業日を保存しました。');
		await expect(dialog).toBeHidden();
		await expect(year.getByRole('button', { name: /^10月14日 \(水\)/ })).toHaveAccessibleName(
			/振替授業日 \(月曜の授業\)/,
		);
		const substitute = page.getByRole('region', { name: '振替授業日' });
		await expect(substitute.getByRole('listitem')).toHaveText(/10\/14 \(水\) は 月曜の授業/);

		await year.getByRole('button', { name: /^10月16日 \(金\)/ }).click();
		await dialog.getByLabel('行事名 (任意)').fill('架空の行事');
		await dialog.getByRole('button', { name: '全学の休講日にする' }).click();
		await expect(page.getByRole('status')).toHaveText('全学の休講日を保存しました。');
		const noClass = page.getByRole('region', { name: '全学の休講日' });
		await expect(noClass.getByRole('listitem')).toContainText('10/16 (金) (架空の行事)');

		// 矢印キーで日を移れる
		await year.getByRole('button', { name: /^10月16日 \(金\)/ }).focus();
		await page.keyboard.press('ArrowRight');
		await expect(year.getByRole('button', { name: /^10月17日 \(土\)/ })).toBeFocused();

		// 学期の終わりも、暦から決められる
		await year.getByRole('button', { name: /^1月20日 \(水\)/ }).click();
		await dialog.getByLabel('学期').selectOption('後期');
		await dialog.getByRole('button', { name: 'この日を終わりにする' }).click();
		await expect(page.getByRole('status')).toHaveText('学期の期間を保存しました。');
		await expect(terms.getByRole('row', { name: /^後期/ })).toContainText(
			'2026-09-24 から 2027-01-20',
		);

		// 週の時間割の日付の横に出る
		await page.goto('/app/week?date=2026-10-12');
		const headers = page.getByRole('table').getByRole('columnheader');
		await expect(headers.filter({ hasText: '10/14 (水)' })).toContainText('月曜の授業を行う日');
		await expect(headers.filter({ hasText: '10/16 (金)' })).toContainText(
			'全学の休講日 (架空の行事)',
		);

		await page.goto('/app/admin/calendar?year=2026');
		page.once('dialog', (dialog) => dialog.accept());
		await noClass.getByRole('button', { name: /^消す/ }).click();
		await expect(page.getByRole('status')).toHaveText('全学の休講日を消しました。');
		await expect(noClass.getByText('ありません。')).toBeVisible();
		page.once('dialog', (dialog) => dialog.accept());
		await substitute.getByRole('button', { name: /^消す/ }).click();
		await expect(page.getByRole('status')).toHaveText('振替授業日を消しました。');
		page.once('dialog', (dialog) => dialog.accept());
		await terms.getByRole('row', { name: /^後期/ }).getByRole('button', { name: /^消す/ }).click();
		await expect(page.getByRole('status')).toContainText('学期の期間を消しました。');
		await expect(terms.getByRole('row', { name: /^後期/ })).toContainText('推定');
	});

	test('PDF でないファイルや、読めない PDF を上げると、理由を出して取り込まない', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto('/app/admin/calendar?year=2026');
		const upload = page.getByRole('region', { name: 'PDF から取り込む' });
		await upload.getByLabel('学年暦の PDF').setInputFiles({
			name: 'calendar.pdf',
			mimeType: 'application/pdf',
			buffer: Buffer.from('<html></html>'),
		});
		await upload.getByRole('button', { name: '読み取る' }).click();
		await expect(page.getByRole('alert')).toHaveText('PDF のファイルではありません。');

		await upload.getByLabel('学年暦の PDF').setInputFiles({
			name: 'calendar.pdf',
			mimeType: 'application/pdf',
			buffer: Buffer.from('%PDF-1.4\n%%EOF'),
		});
		await upload.getByRole('button', { name: '読み取る' }).click();
		await expect(page.getByRole('alert')).toContainText('学年暦の PDF として読めませんでした');
		await expect(page.getByRole('button', { name: 'この内容で取り込む' })).toHaveCount(0);
	});

	test('授業時間割の取り込みの画面でも、読めない PDF は取り込まない', async ({ page }) => {
		await loginAsAdmin(page);
		await page.goto('/app/settings');
		await page.getByRole('link', { name: '授業時間割の取り込み' }).click();
		await page.getByLabel('授業時間割の PDF').setInputFiles({
			name: 'timetable.pdf',
			mimeType: 'application/pdf',
			buffer: Buffer.from('%PDF-1.4\n%%EOF'),
		});
		await page.getByRole('button', { name: '読み取る' }).click();
		await expect(page.getByRole('alert')).toContainText('授業時間割の PDF として読めませんでした');
	});
});

test.describe('通知欄', () => {
	// 手元では DB が残るので、利用者と休講の授業名を毎回変える
	const stamp = Date.now();
	const email = `e2e-notify-${stamp}@fun.ac.jp`;
	const lessonName = `架空の演習 (通知 ${stamp})`;

	test('履修している科目の休講が通知欄に入り、ベルに未読数が出る。開くと授業の画面へ移り、既読になる', async ({
		page,
	}) => {
		oidc.setIdentity({ sub: email, email, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		await page.goto('/app');
		await expect(page.getByRole('link', { name: '通知', exact: true }).first()).toBeVisible();

		// 履修を入れてから、そのあとに見つけた休講を入れる
		seedSubjects((database, exerciseId) => {
			const user = database.sqlite.prepare('SELECT id FROM users WHERE email = ?').get(email) as {
				id: string;
			};
			const now = Date.now();
			database.sqlite
				.prepare(
					'INSERT INTO course_registrations (user_id, subject_id, created_at) VALUES (?, ?, ?)',
				)
				.run(user.id, exerciseId, now - 60_000);
			database.sqlite
				.prepare(
					`INSERT INTO class_changes (kind, subject_id, lesson_name, date, period, first_seen_at, last_seen_at)
						VALUES ('cancellation', ?, ?, '2030-01-07', 2, ?, ?)`,
				)
				.run(exerciseId, lessonName, now, now);
		});

		// 管理者が、休講などを通知欄に入れる定期処理を今すぐ動かす
		const admin = 'e2e-admin@fun.ac.jp';
		oidc.setIdentity({ sub: admin, email: admin, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		await page.goto('/app/admin/status');
		await page
			.getByRole('region', { name: '今すぐ動かす' })
			.getByRole('listitem')
			.filter({ hasText: '休講などの通知欄への記録' })
			.getByRole('button', { name: '動かす' })
			.click();
		await expect(page.getByRole('status').first()).toContainText('休講などの通知を');

		oidc.setIdentity({ sub: email, email, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		await page.goto('/app');
		await page.getByRole('link', { name: '通知 (未読 1 件)' }).first().click();
		await expect(page.getByRole('heading', { level: 1, name: '通知' })).toBeVisible();
		const item = page.getByRole('button', { name: /\[休講\] 架空の演習Ⅱ1-AB \(1\/7 2 限\)/ });
		await expect(item).toContainText('未読');

		await item.click();
		await expect(page).toHaveURL(/\/app\/subjects\/2026\/900001$/);
		await page.goto('/app/notifications');
		await expect(item).not.toContainText('未読');
		await expect(page.getByRole('link', { name: '通知', exact: true }).first()).toBeVisible();
		await expect(page.getByRole('button', { name: 'すべて既読にする' })).toBeDisabled();

		// 種類で絞り込む
		await page
			.getByRole('navigation', { name: '種類で絞り込む' })
			.getByRole('link', { name: '補講' })
			.click();
		await expect(page.getByText('通知はまだありません。')).toBeVisible();
	});
});

test.describe('サポートサーバーの招待', () => {
	// 手元では DB が残るので、前の実行で入れた招待を消してから始める
	test.beforeAll(() => {
		seedSubjects((database) => {
			database.sqlite.prepare("DELETE FROM settings WHERE key = 'support-invites'").run();
		});
	});

	test.afterAll(() => {
		seedSubjects((database) => {
			database.sqlite.prepare("DELETE FROM settings WHERE key = 'support-invites'").run();
		});
	});

	test('管理者が自分で作った招待を登録して公開すると、「このアプリについて」に出る。取り消すと消える', async ({
		page,
	}) => {
		const email = 'e2e-admin@fun.ac.jp';
		oidc.setIdentity({ sub: email, email, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		await page.goto('/app/settings');
		await page.getByRole('link', { name: 'サポートサーバーの招待' }).click();
		// E2E では Bot を設定していない
		await expect(page.getByRole('region', { name: 'Bot で発行する' })).toContainText(
			'DISCORD_BOT_TOKEN',
		);

		const register = page.getByRole('region', { name: '自分で作った招待を登録する' });
		await register.getByLabel('招待の URL').fill('https://example.com/abc');
		await register.getByRole('button', { name: '登録する' }).click();
		await expect(page.getByRole('alert')).toContainText('Discord の招待の URL');

		await register.getByLabel('招待の URL').fill('https://discord.gg/e2eSupport');
		await register.getByLabel('メモ (任意)').fill('E2E');
		await register.getByRole('button', { name: '登録する' }).click();
		await expect(page.getByRole('status')).toContainText('招待を登録しました');
		const item = page
			.getByRole('region', { name: '使える招待' })
			.getByRole('listitem')
			.filter({ hasText: 'https://discord.gg/e2eSupport' });
		await expect(item).toContainText('非公開');

		// 非公開のうちは出ない
		await page.goto('/about');
		await expect(page.getByRole('link', { name: 'Discord のサポートサーバー' })).toHaveCount(0);

		await page.goto('/app/admin/support-invites');
		await item.getByRole('button', { name: '公開する' }).click();
		await expect(page.getByRole('status')).toContainText('公開にしました');
		await page.goto('/about');
		const link = page.getByRole('link', { name: 'Discord のサポートサーバー' });
		await expect(link).toHaveAttribute('href', 'https://discord.gg/e2eSupport');
		await expect(link).toHaveAttribute('target', '_blank');

		await page.goto('/app/admin/support-invites');
		await item.getByRole('button', { name: '取り消す' }).click();
		await expect(page.getByRole('status')).toContainText('招待を取り消しました');
		await expect(
			page.getByRole('region', { name: '使えなくなった招待' }).getByRole('listitem'),
		).toContainText('取り消し済み');
		await page.goto('/about');
		await expect(page.getByRole('link', { name: 'Discord のサポートサーバー' })).toHaveCount(0);
	});

	test('管理者でなければ、見つからないことにする', async ({ page }) => {
		const email = 'e2e-not-admin@fun.ac.jp';
		oidc.setIdentity({ sub: email, email, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		const response = await page.goto('/app/admin/support-invites');
		expect(response?.status()).toBe(404);
	});
});

test.describe('取得元と実行履歴', () => {
	test.beforeAll(() => {
		seedSubjects((database) => {
			// 未来の時刻にして、実行履歴の先頭に出す
			const started = Date.parse('2030-01-01T03:00:00Z');
			database.sqlite
				.prepare(
					`INSERT OR REPLACE INTO source_status
						(source, last_success_at, last_attempt_at, consecutive_failures, next_attempt_at, last_error)
						VALUES ('portal', ?, ?, 3, ?, '架空のタイムアウト')`,
				)
				.run(started - 3_600_000, started, started + 3_600_000);
			database.sqlite.prepare("DELETE FROM job_runs WHERE message = '架空のタイムアウト'").run();
			database.sqlite
				.prepare(
					`INSERT INTO job_runs (job, started_at, finished_at, status, message)
						VALUES ('scrape-portal', ?, ?, 'failed', '架空のタイムアウト')`,
				)
				.run(started, started + 2_000);
		});
	});

	// 手元では DB が残るので、入れた行を消す (今日の画面の「まだ取得していません」のテストに響くため)
	test.afterAll(() => {
		seedSubjects((database) => {
			database.sqlite.prepare("DELETE FROM source_status WHERE source = 'portal'").run();
			database.sqlite.prepare("DELETE FROM job_runs WHERE message = '架空のタイムアウト'").run();
		});
	});

	test('管理者は、取得元の状態と実行履歴を見られる', async ({ page }) => {
		const email = 'e2e-admin@fun.ac.jp';
		oidc.setIdentity({ sub: email, email, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		await page.goto('/app/settings');
		await page.getByRole('link', { name: '取得元と実行履歴' }).click();

		const portal = page
			.getByRole('region', { name: '取得元の状態' })
			.getByRole('listitem')
			.filter({ hasText: '学生ポータル (休講など)' });
		await expect(portal).toContainText('不調');
		await expect(portal).toContainText('最終試行 2030-01-01 12:00');
		await expect(portal).toContainText('架空のタイムアウト');

		const first = page.getByRole('region', { name: '定期処理の実行履歴' }).getByRole('row').nth(1);
		await expect(first).toContainText('2030-01-01 12:00');
		await expect(first).toContainText('休講などの取得');
		await expect(first).toContainText('失敗');
		await expect(first).toContainText('2 秒');
	});

	test('管理者は、定期処理を今すぐ動かせる。応答時間の分布も見られる', async ({ page }) => {
		const email = 'e2e-admin@fun.ac.jp';
		oidc.setIdentity({ sub: email, email, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		await page.goto('/app/admin/status');

		// 外へ通信しない処理 (時間割の PDF の取り込みの案内) を動かす
		await page
			.getByRole('region', { name: '今すぐ動かす' })
			.getByRole('listitem')
			.filter({ hasText: '時間割の PDF の取り込みの案内' })
			.getByRole('button', { name: '動かす' })
			.click();
		await expect(page.getByRole('status').first()).toContainText(
			'時間割の PDF の取り込みの案内 を動かしました',
		);
		await expect(
			page
				.getByRole('region', { name: '定期処理の実行履歴' })
				.getByRole('row')
				.filter({ hasText: '時間割の PDF の取り込みの案内' })
				.first(),
		).toContainText('成功');

		// ここまでの画面の表示で、応答時間が記録されている
		const responses = page.getByRole('region', { name: '応答時間 (直近 24 時間)' });
		await expect(responses).toContainText('100 ms 以内');
		await expect(responses.getByRole('table', { name: '応答時間の分布' })).toBeVisible();
	});

	test('管理者でなければ、見つからないことにする', async ({ page }) => {
		const email = 'e2e-not-admin@fun.ac.jp';
		oidc.setIdentity({ sub: email, email, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		const response = await page.goto('/app/admin/status');
		expect(response?.status()).toBe(404);
	});
});

test.describe('招待コード', () => {
	const loginAs = async (page: import('@playwright/test').Page, email: string) => {
		oidc.setIdentity({ sub: email, email, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		await expect(page).toHaveURL('/app');
	};
	// E2E の DB は実行をまたいで残る。月の上限に届かないよう、実行ごとに別の人にする
	const member = `e2e-invite-${Date.now()}@fun.ac.jp`;

	test('管理者は招待コードを発行でき、登録の URL を 1 回だけ出す。一覧に出て、取り消せる', async ({
		page,
	}) => {
		await loginAs(page, 'e2e-admin@fun.ac.jp');
		// 招待は、メニューではなく、設定の中にある
		await expect(
			page
				.getByRole('navigation', { name: 'メニュー' })
				.first()
				.getByRole('link', { name: '招待' }),
		).toHaveCount(0);
		await page.goto('/app/settings');
		await page.getByRole('link', { name: /^招待 友だち/ }).click();
		await expect(page).toHaveURL('/app/settings/invites');
		await expect(page.getByRole('navigation', { name: 'パンくず' })).toContainText('設定');
		await page.getByLabel('使用回数').fill('2');
		await page.getByLabel(/^メモ/).fill('E2E の研究室');
		await page.getByRole('button', { name: '招待コードを発行する' }).click();

		const url = page.getByLabel('登録の URL');
		await expect(url).toHaveValue(/\/signup\?code=[\w-]+$/);
		const list = page.getByRole('region', { name: '発行した招待コード' });
		await expect(list).toContainText('E2E の研究室');
		await expect(list).toContainText('使用 0 / 2 回');

		// 開き直すと、コードはもう出ない
		await page.reload();
		await expect(page.getByLabel('登録の URL')).toHaveCount(0);

		// 取り消したコードは、一覧から消える (E2E の DB は実行をまたいで残るので、数で確かめる)
		const lab = list.getByRole('listitem').filter({ hasText: 'E2E の研究室' });
		const before = await lab.count();
		page.once('dialog', (dialog) => dialog.accept());
		await lab
			.first()
			.getByRole('button', { name: /^取り消す/ })
			.click();
		await expect(page.getByRole('status').first()).toHaveText('招待コードを取り消しました。');
		await expect(lab).toHaveCount(before - 1);
	});

	test('管理者のみのモードでは、ほかの人には招待が出ない。許可したユーザーのモードで許可すると、発行できる', async ({
		browser,
	}) => {
		const memberPage = await (await browser.newContext()).newPage();
		await loginAs(memberPage, member);
		await memberPage.goto('/app/settings');
		await expect(memberPage.getByRole('link', { name: /^招待 友だち/ })).toHaveCount(0);
		await memberPage.goto('/app/settings/invites');
		await expect(memberPage.getByRole('button', { name: '招待コードを発行する' })).toHaveCount(0);

		const adminPage = await (await browser.newContext()).newPage();
		await loginAs(adminPage, 'e2e-admin@fun.ac.jp');
		await adminPage.goto('/app/admin/invites');
		const memberRow = adminPage.getByRole('listitem').filter({ hasText: member });
		const limit = adminPage.getByLabel('管理者でない人が 1 か月に発行できる数');
		// 管理者のみのときは、月の上限を使わない
		await expect(limit).toBeDisabled();
		await adminPage.getByLabel(/許可したユーザー/).check();
		await expect(limit).toBeEnabled();
		await expect(adminPage.getByText('保存していない変更があります')).toBeVisible();
		await adminPage.getByRole('button', { name: '保存する' }).click();
		await expect(adminPage.getByRole('status')).toHaveText(
			'招待コードを発行できる人の設定を保存しました。',
		);
		// 保存したあとも、選んだモードと上限がそのまま出ている
		await expect(adminPage.getByLabel(/許可したユーザー/)).toBeChecked();
		await expect(limit).toHaveValue('5');
		await expect(adminPage.getByText('保存していない変更があります')).toBeHidden();
		await memberRow.getByRole('button', { name: /^許可する/ }).click();
		await expect(memberRow.getByRole('button', { name: /^許可を外す/ })).toBeVisible();

		await memberPage.goto('/app/settings/invites');
		// 管理者でない人は、回数と期限を決められない
		await expect(memberPage.getByLabel('使用回数')).toHaveCount(0);
		await expect(memberPage.getByText('今月はあと 5')).toBeVisible();
		await memberPage.getByRole('button', { name: '招待コードを発行する' }).click();
		await expect(memberPage.getByLabel('登録の URL')).toHaveValue(/\/signup\?code=/);
		await expect(memberPage.getByRole('region', { name: '発行した招待コード' })).toContainText(
			'使用 0 / 1 回',
		);

		// ほかのテストに影響しないよう、管理者のみに戻す
		await memberRow.getByRole('button', { name: /^許可を外す/ }).click();
		await adminPage.getByLabel(/管理者のみ/).check();
		await expect(limit).toBeDisabled();
		await adminPage.getByRole('button', { name: '保存する' }).click();
		await expect(adminPage.getByRole('status')).toHaveText(
			'招待コードを発行できる人の設定を保存しました。',
		);
		await expect(adminPage.getByLabel(/管理者のみ/)).toBeChecked();
		// 無効にした欄は送られないが、前に決めた上限は残る
		await expect(limit).toHaveValue('5');
	});
});

test.describe('自分の予定', () => {
	// E2E の DB は実行をまたいで残るので、実行ごとに別の人にする
	const owner = `e2e-events-${Date.now()}@fun.ac.jp`;
	const other = `e2e-events-other-${Date.now()}@fun.ac.jp`;
	const login = async (page: import('@playwright/test').Page, email: string) => {
		oidc.setIdentity({ sub: email, email, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		await expect(page).toHaveURL('/app');
	};

	test('予定を足し、繰り返しを設定し、ある日を除き、直し、消せる。ほかの人には見えない', async ({
		browser,
		page,
	}) => {
		await login(page, owner);
		await page.getByRole('link', { name: '時間割', exact: true }).click();
		await page.getByRole('link', { name: '自分の予定' }).click();
		await expect(page.getByText('まだ予定がありません')).toBeVisible();

		// 毎週 月と水、時限で、4 回まで
		await page.getByRole('link', { name: '予定を足す' }).click();
		await page.getByLabel('予定の名前').fill('架空のサークル練習');
		await page.getByLabel('場所 (任意)').fill('架空の部室');
		await page.getByLabel('開始日').fill('2026-11-02');
		await page.getByRole('radio', { name: '時限で決める' }).check();
		await page.getByLabel('始まりの時限').selectOption('5');
		await page.getByLabel('終わりの時限').selectOption('6');
		await page.getByLabel('繰り返しの種類').selectOption('weekly');
		await page.getByRole('checkbox', { name: '月' }).check();
		await page.getByRole('checkbox', { name: '水' }).check();
		await page.getByRole('radio', { name: '回数まで' }).check();
		await page.getByLabel('繰り返す回数').fill('4');
		await page.getByRole('button', { name: '足す' }).click();

		await expect(page.getByRole('status')).toHaveText('予定を足しました。');
		const item = page.getByRole('listitem').filter({ hasText: '架空のサークル練習' });
		await expect(item).toContainText('11/2 (月)、5 限から 6 限');
		await expect(item).toContainText('繰り返し: 毎週 月、水、4 回まで');
		await expect(item).toContainText('場所: 架空の部室');

		// 11/4 の回を除く
		await item.getByRole('link', { name: /^編集/ }).click();
		await expect(page.getByLabel('予定の名前')).toHaveValue('架空のサークル練習');
		await page.getByRole('checkbox', { name: /^11\/4 \(水\)/ }).check();
		await page.getByRole('button', { name: '保存する' }).click();
		await expect(page.getByRole('status')).toHaveText('予定を直しました。');
		await page.getByRole('link', { name: /^編集/ }).click();
		await expect(page.getByRole('checkbox', { name: /^11\/4 \(水\)/ })).toBeChecked();
		await expect(page.getByRole('checkbox', { name: /^11\/2 \(月\)/ })).not.toBeChecked();

		// 誤りは、入力を残して知らせる
		await page.getByLabel('終了日 (数日にわたるときだけ)').fill('2026-10-01');
		await page.getByRole('button', { name: '保存する' }).click();
		await expect(page.getByRole('alert')).toContainText('終了日は、開始日以降にしてください');
		await expect(page.getByLabel('場所 (任意)')).toHaveValue('架空の部室');

		// ほかの人には、見えず、開けない
		const editUrl = page.url();
		const otherPage = await (await browser.newContext()).newPage();
		await login(otherPage, other);
		expect((await otherPage.goto(editUrl))?.status()).toBe(404);
		await otherPage.goto('/app/events');
		await expect(otherPage.getByText('まだ予定がありません')).toBeVisible();

		// 消す
		page.once('dialog', (dialog) => dialog.accept());
		await page.getByRole('button', { name: 'この予定を消す' }).click();
		await expect(page.getByRole('status')).toHaveText('予定を消しました。');
		await expect(page.getByText('まだ予定がありません')).toBeVisible();
	});

	test('足した予定が、今日の画面と週の時間割に出る', async ({ page }) => {
		await login(page, `e2e-events-views-${Date.now()}@fun.ac.jp`);
		// 日本時間の今日
		const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
		await page.goto('/app/events');
		await page.getByRole('link', { name: '予定を足す' }).click();
		await expect(page.getByRole('heading', { name: '予定を足す' })).toBeVisible();
		await page.getByLabel('予定の名前').fill('今日の架空の予定');
		await page.getByLabel('場所 (任意)').fill('架空の広場');
		await page.getByLabel('開始日').fill(today);
		await page.getByRole('radio', { name: '終日' }).check();
		await page.getByRole('button', { name: '足す' }).click();
		await expect(page.getByRole('status')).toHaveText('予定を足しました。');

		// ホームの画面
		await page
			.getByRole('navigation', { name: 'メニュー' })
			.getByRole('link', { name: 'ホーム', exact: true })
			.click();
		const section = page.getByRole('region', { name: '今日の予定' });
		await expect(section).toContainText('終日');
		await expect(section).toContainText('今日の架空の予定');
		await expect(section).toContainText('架空の広場');
		await section.getByRole('link', { name: '今日の架空の予定' }).click();
		await expect(page.getByRole('heading', { name: '予定を直す' })).toBeVisible();

		// 週の時間割の「予定」の行
		await page.goto('/app/week');
		const row = page
			.getByRole('row')
			.filter({ has: page.getByRole('rowheader', { name: '予定' }) });
		await expect(row).toContainText('今日の架空の予定');
		await expect(row).toContainText('終日');
	});

	test('公開範囲を選べる。全体に公開した予定は、ほかの人が探して加えられ、限定公開は、リンクの値でだけ開ける', async ({
		browser,
		page,
	}) => {
		// テスト用の DB は実行をまたいで残るので、予定の名前は、実行ごとに変える
		const suffix = String(Date.now());
		const publicTitle = `全体の架空の予定${suffix}`;
		const linkTitle = `限定の架空の予定${suffix}`;
		const privateTitle = `自分だけの架空の予定${suffix}`;
		const create = async (
			target: import('@playwright/test').Page,
			title: string,
			visibility: '自分だけ' | '共有のリンクを知っている人' | 'Funmary にログインしている全員',
		) => {
			await target.goto('/app/events');
			await target.getByRole('link', { name: '予定を足す' }).click();
			await expect(target.getByRole('heading', { name: '予定を足す' })).toBeVisible();
			await target.getByLabel('予定の名前').fill(title);
			await target.getByLabel('開始日').fill('2026-12-07');
			await target.getByRole('radio', { name: '終日' }).check();
			await target.getByRole('radio', { name: new RegExp(`^${visibility}`) }).check();
			await target.getByRole('button', { name: '足す' }).click();
			await expect(target.getByRole('status')).toHaveText('予定を足しました。');
		};

		await login(page, `e2e-events-owner-${Date.now()}@fun.ac.jp`);
		await create(page, publicTitle, 'Funmary にログインしている全員');
		await create(page, linkTitle, '共有のリンクを知っている人');
		await create(page, privateTitle, '自分だけ');

		// 限定公開の予定には、共有のリンクが出る。自分だけの予定には出ない
		await page
			.getByRole('listitem')
			.filter({ hasText: linkTitle })
			.getByRole('link', { name: /^編集/ })
			.click();
		const linkField = page.getByLabel('リンク', { exact: true });
		const firstLink = await linkField.inputValue();
		expect(firstLink).toMatch(/\/app\/events\/shared\/[\w-]{43}$/);
		await page.goto('/app/events');
		await page
			.getByRole('listitem')
			.filter({ hasText: privateTitle })
			.getByRole('link', { name: /^編集/ })
			.click();
		await expect(page.getByRole('heading', { name: '共有のリンク' })).toHaveCount(0);

		// ほかの人: みんなの予定には、全体の予定だけが出る。持ち主の情報は出ない
		const viewer = await (await browser.newContext()).newPage();
		await login(viewer, `e2e-events-viewer-${Date.now()}@fun.ac.jp`);
		await viewer.goto('/app/events');
		await viewer.getByRole('link', { name: 'みんなの予定を探す' }).click();
		const publicItem = viewer.getByRole('listitem').filter({ hasText: publicTitle });
		await expect(publicItem).toBeVisible();
		await expect(viewer.getByText(linkTitle)).toHaveCount(0);
		await expect(viewer.getByText(privateTitle)).toHaveCount(0);
		await expect(viewer.getByText('e2e-events-owner')).toHaveCount(0);

		// 加える。自分の予定の一覧に「加えた予定」が出る。外せる
		await publicItem.getByRole('link', { name: publicTitle }).click();
		await viewer.getByRole('button', { name: '自分の時間割に加える' }).click();
		await expect(viewer.getByRole('status')).toHaveText('自分の時間割に加えました。');
		// 加えた予定は、その日の週の時間割に出る
		await viewer.goto('/app/week?date=2026-12-07');
		const added = viewer
			.getByRole('row')
			.filter({ has: viewer.getByRole('rowheader', { name: '予定' }) });
		await expect(added).toContainText(publicTitle);
		await expect(added).toContainText('加えた予定');
		await viewer.goto('/app/events');
		await expect(viewer.getByRole('region', { name: '加えた予定' })).toContainText(publicTitle);
		await viewer
			.getByRole('region', { name: '加えた予定' })
			.getByRole('link', { name: /^開く/ })
			.click();
		await viewer.getByRole('button', { name: '自分の時間割から外す' }).click();
		await expect(viewer.getByRole('status')).toHaveText('自分の時間割から外しました。');

		// 限定公開は、リンクの値で開ける。番号では開けない。作り直すと、前のリンクは開けない
		await viewer.goto(firstLink);
		await expect(viewer.getByRole('heading', { name: linkTitle })).toBeVisible();
		expect((await viewer.goto(firstLink.replace(/[\w-]{43}$/, '1')))?.status()).toBe(404);
		await page.goto('/app/events');
		await page
			.getByRole('listitem')
			.filter({ hasText: linkTitle })
			.getByRole('link', { name: /^編集/ })
			.click();
		await page.getByRole('button', { name: 'リンクを作り直す' }).click();
		await expect(page.getByRole('status')).toContainText('共有のリンクを作り直しました');
		await expect(linkField).not.toHaveValue(firstLink);
		expect((await viewer.goto(firstLink))?.status()).toBe(404);
	});

	test('ログインしていなければ、ログインの画面に移る', async ({ page }) => {
		await page.goto('/app/events');
		await expect(page).toHaveURL('/login');
	});
});

test.describe('スマホの上部バーと、フッターのリンク', () => {
	const loginAs = async (page: import('@playwright/test').Page) => {
		const email = `e2e-header-${Date.now()}@fun.ac.jp`;
		oidc.setIdentity({ sub: email, email, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		await expect(page).toHaveURL('/app');
	};

	test('下へのスクロールで隠れ、上へのスクロールで出る。一番上では常に出る', async ({ page }) => {
		await loginAs(page);
		await page.setViewportSize({ width: 390, height: 700 });
		await page.goto('/app/week?date=2026-10-07');
		await page.getByRole('button', { name: '週', exact: true }).click();

		const header = page.locator('header.top');
		await expect(header).toBeVisible();

		await page.mouse.wheel(0, 600);
		await expect(header).toHaveCSS('transform', /matrix\(1, 0, 0, 1, 0, -/);

		await page.mouse.wheel(0, -600);
		await expect(header).toHaveCSS('transform', 'none');

		// 一番上に戻ると、必ず出る
		await page.mouse.wheel(0, 600);
		await page.mouse.wheel(0, -100000);
		await expect(header).toHaveCSS('transform', 'none');
	});

	test('フッターに、リポジトリへのリンクが常に出る', async ({ page }) => {
		await page.goto('/');
		const link = page.getByRole('link', { name: 'ソースコード (GitHub)' });
		await expect(link).toHaveAttribute('href', REPOSITORY_URL);
		await expect(link).toHaveAttribute('target', '_blank');
		await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

		await loginAs(page);
		await expect(page.getByRole('link', { name: 'ソースコード (GitHub)' })).toBeVisible();
	});
});

test.describe('カレンダーの購読', () => {
	// E2E の DB は実行をまたいで残るので、実行ごとに別の人にする
	const email = `e2e-calendar-${Date.now()}@fun.ac.jp`;

	test('購読の URL を発行して ICS を取れ、再発行と無効化で前の URL が使えなくなる', async ({
		page,
	}) => {
		oidc.setIdentity({ sub: email, email, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		await page
			.getByRole('navigation', { name: 'メニュー' })
			.getByRole('link', { name: '設定', exact: true })
			.click();
		await page.getByRole('link', { name: /カレンダーの購読/ }).click();

		// パンくずで、いまの場所と設定への戻り方が分かる
		const breadcrumb = page.getByRole('navigation', { name: 'パンくず' });
		await expect(breadcrumb.getByRole('listitem')).toHaveText(['設定', 'カレンダーの購読']);
		await expect(breadcrumb.getByText('カレンダーの購読')).toHaveAttribute('aria-current', 'page');
		await breadcrumb.getByRole('link', { name: '設定' }).click();
		await expect(page).toHaveURL('/app/settings');
		await page.getByRole('link', { name: /カレンダーの購読/ }).click();

		await page.getByRole('button', { name: '購読の URL を発行する' }).click();

		const url = page.getByLabel('購読の URL', { exact: true });
		await expect(url).toHaveValue(/\/cal\/[\w-]{43}\.ics$/);
		const first = await url.inputValue();
		await expect(page.getByRole('img', { name: '購読の URL の QR コード' })).toBeVisible();
		const google = page.getByRole('link', { name: 'Google カレンダーに追加' });
		await expect(google).toHaveAttribute('href', /^https:\/\/calendar\.google\.com\//);
		await expect(google).toHaveAttribute('target', '_blank');
		await expect(google).toHaveAttribute('rel', 'noopener noreferrer');

		const ics = await page.request.get(first);
		expect(ics.status()).toBe(200);
		expect(ics.headers()['content-type']).toBe('text/calendar; charset=utf-8');
		expect(ics.headers()['x-robots-tag']).toBe('noindex');
		expect(await ics.text()).toContain('BEGIN:VCALENDAR');

		// 開き直すと URL はもう出ず、取りに来た日時が出る
		await page.reload();
		await expect(page.getByLabel('購読の URL', { exact: true })).toHaveCount(0);
		await expect(page.getByText('まだ取りに来ていません')).toHaveCount(0);

		await page.getByRole('button', { name: '再発行する' }).click();
		await expect(page.getByLabel('購読の URL', { exact: true })).not.toHaveValue(first);
		const second = await page.getByLabel('購読の URL', { exact: true }).inputValue();
		expect((await page.request.get(first)).status()).toBe(404);
		expect((await page.request.get(second)).status()).toBe(200);

		page.once('dialog', (dialog) => dialog.accept());
		await page.getByRole('button', { name: '無効にする' }).click();
		await expect(page.getByRole('status').first()).toHaveText(/購読の URL を無効にしました/);
		expect((await page.request.get(second)).status()).toBe(404);
		await expect(page.getByRole('button', { name: '購読の URL を発行する' })).toBeVisible();
	});
});

test.describe('このアプリについて', () => {
	const loginAs = async (page: import('@playwright/test').Page) => {
		const email = `e2e-about-${Date.now()}@fun.ac.jp`;
		oidc.setIdentity({ sub: email, email, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		await expect(page).toHaveURL('/app');
	};

	test('設定の「アカウント」のすぐ上に、4 つの項目が並ぶ', async ({ page }) => {
		await loginAs(page);
		await page.goto('/app/settings');

		const headings = page.getByRole('heading', { level: 2 });
		const titles = await headings.allTextContents();
		const accountIndex = titles.indexOf('アカウント');
		expect(titles[accountIndex - 1]).toBe('このアプリについて');

		const section = page.locator('section', {
			has: page.getByRole('heading', { name: 'このアプリについて' }),
		});
		for (const path of ['/about', '/license', '/third-party-licenses', '/contributors']) {
			await expect(section.locator(`a[href="${path}"]`)).toBeVisible();
		}
	});

	test('リポジトリと作者の画面に、GitHub とコントリビューターへのリンクが出る', async ({
		page,
	}) => {
		await loginAs(page);
		await page.goto('/about');

		const repo = page.locator(`a[href="${REPOSITORY_URL}"]`).first();
		await expect(repo).toHaveAttribute('target', '_blank');
		await expect(repo).toHaveAttribute('rel', 'noopener noreferrer');

		// Contributors の画面は GitHub から取得するので、ここでは開かない
		await expect(
			page.getByRole('link', { name: 'コードを書いてくれた人たち', exact: true }),
		).toHaveAttribute('href', '/contributors');
		await expect(page.getByRole('link', { name: '設定', exact: true })).toHaveAttribute(
			'href',
			'/app/settings',
		);
	});

	test('ライセンスの画面に、BSD-3-Clause と Apache-2.0、ロゴとアイコンの利用条件の本文が出る', async ({
		page,
	}) => {
		await loginAs(page);
		await page.goto('/license');
		const license = (name: string) =>
			page.locator('details').filter({ has: page.getByText(name, { exact: true }) });

		await page.getByText('BSD-3-Clause', { exact: true }).click();
		await expect(license('BSD-3-Clause').getByText('Redistribution and use')).toBeVisible();

		await page.getByText('Apache-2.0', { exact: true }).click();
		await expect(license('Apache-2.0').getByText('Apache License')).toBeVisible();

		await page.getByText('ロゴとアイコンの利用条件', { exact: true }).click();
		await expect(
			license('ロゴとアイコンの利用条件').getByText('許可なくしてはいけないこと'),
		).toBeVisible();
	});

	test('サードパーティライセンスの画面に、依存の一覧が出る', async ({ page }) => {
		await loginAs(page);
		await page.goto('/third-party-licenses');

		await expect(
			page.getByText('Funmary が使っているオープンソースのソフトウェアのライセンスです。'),
		).toBeVisible();
	});

	test('このアプリについての画面は、ログインしていなくても開け、パンくずはトップに戻る', async ({
		page,
	}) => {
		await page.goto('/');
		await page.getByRole('link', { name: 'このアプリについて' }).click();
		await expect(page).toHaveURL('/about');
		await expect(page.getByRole('heading', { name: 'リポジトリと作者', level: 1 })).toBeVisible();
		await expect(page.getByRole('link', { name: 'トップ', exact: true })).toHaveAttribute(
			'href',
			'/',
		);

		await page.getByRole('link', { name: 'ライセンス', exact: true }).click();
		await expect(page).toHaveURL('/license');
		await expect(page.getByRole('heading', { name: 'ライセンス', level: 1 })).toBeVisible();

		await page.goto('/third-party-licenses');
		await expect(
			page.getByRole('heading', { name: 'サードパーティライセンス', level: 1 }),
		).toBeVisible();
	});

	test('設定の下にあった前の URL は、ルートの下の URL に転送する', async ({ request }) => {
		for (const name of ['about', 'license', 'third-party-licenses', 'contributors']) {
			const response = await request.get(`/app/settings/${name}`, { maxRedirects: 0 });
			expect(response.status()).toBe(308);
			expect(response.headers()['location']).toBe(`/${name}`);
		}
	});

	// E2E のサーバーは DISCORD_CLIENT_ID/SECRET を設定していないので、常にこの状態になる (#163)
	test('Discord 連携の OAuth が設定されていなければ、設定に入口を出さず、直接開いても使えないと出す', async ({
		page,
	}) => {
		await loginAs(page);
		await page.goto('/app/settings');
		await expect(page.getByRole('link', { name: 'Discord連携' })).toHaveCount(0);

		await page.goto('/app/settings/discord');
		await expect(page.getByRole('heading', { name: 'Discord連携', level: 1 })).toBeVisible();
		await expect(page.getByText('いまは Discord 連携を使えません。')).toBeVisible();
	});
});

test.describe('Discord の Webhook', () => {
	const stamp = Date.now();
	const email = `e2e-webhook-${stamp}@fun.ac.jp`;
	const webhookUrl = `https://discord.com/api/webhooks/123456/e2e-token-${stamp}`;

	test('登録、保存、無効化、削除ができる。URL は末尾を伏せて出す', async ({ page }) => {
		oidc.setIdentity({ sub: email, email, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		await page.goto('/app/settings');
		await page.getByRole('link', { name: 'Discord の Webhook' }).click();
		await expect(page.getByRole('heading', { level: 1, name: 'Discord の Webhook' })).toBeVisible();

		// Discord の Webhook でない URL は、登録できない
		await page.getByLabel('Webhook の URL').fill('https://example.com/hook');
		await page.getByRole('button', { name: '登録して、テスト通知を送る' }).click();
		await expect(page.getByRole('alert')).toContainText('Discord の Webhook の URL');

		await page.getByLabel('Webhook の URL').fill(webhookUrl);
		await page.getByLabel('名前 (任意)').first().fill('友人と共有');
		await page.getByRole('button', { name: '登録して、テスト通知を送る' }).click();
		await expect(page.getByRole('status')).toContainText('Webhook を登録しました');
		const item = page.getByRole('listitem').filter({ hasText: '友人と共有' });
		await expect(item).toContainText('https://discord.com/api/webhooks/123456/…');
		await expect(page.getByText(`e2e-token-${stamp}`)).toHaveCount(0);

		// 同じ Webhook は、二重に登録できない
		await page.getByLabel('Webhook の URL').fill(webhookUrl);
		await page.getByRole('button', { name: '登録して、テスト通知を送る' }).click();
		await expect(page.getByRole('alert')).toContainText('すでに登録しています');

		// 届ける通知の種類を変えて保存する。開き直しても残る
		await item.getByLabel('補講').uncheck();
		await item.getByRole('button', { name: '保存する' }).click();
		await expect(page.getByRole('status')).toHaveText('保存しました。');
		await page.reload();
		await expect(item.getByLabel('補講')).not.toBeChecked();
		await expect(item.getByLabel('休講')).toBeChecked();

		await item.getByRole('button', { name: '無効にする' }).click();
		await expect(item).toContainText('無効');
		await expect(item.getByRole('button', { name: 'テスト通知を送る' })).toBeDisabled();
		await item.getByRole('button', { name: '有効に戻す' }).click();
		await expect(item.getByRole('button', { name: 'テスト通知を送る' })).toBeEnabled();

		page.once('dialog', (dialog) => dialog.accept());
		await item.getByRole('button', { name: '削除する' }).click();
		await expect(item).toHaveCount(0);
	});

	test('管理者が上限を 0 にすると、新しく登録できない。戻すと登録できる', async ({ page }) => {
		const admin = 'e2e-admin@fun.ac.jp';
		oidc.setIdentity({ sub: admin, email: admin, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		await page.goto('/app/admin/webhooks');
		await page.getByLabel(/1 人あたりの上限/).fill('0');
		await page.getByRole('button', { name: '保存する' }).click();
		await expect(page.getByRole('status')).toHaveText('上限を 0 個にしました。');

		await page.goto('/app/settings/webhooks');
		await expect(page.getByText('上限に達しています')).toBeVisible();
		await expect(page.getByRole('button', { name: '登録して、テスト通知を送る' })).toHaveCount(0);

		await page.goto('/app/admin/webhooks');
		await page.getByLabel(/1 人あたりの上限/).fill('5');
		await page.getByRole('button', { name: '保存する' }).click();
		await expect(page.getByRole('status')).toHaveText('上限を 5 個にしました。');
	});
});
