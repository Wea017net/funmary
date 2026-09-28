// Google のログインの通し (設計書 21 章)。Google の代わりに、テスト用の OpenID Connect のサーバーを使う。
// サーバーは本物の RS256 で署名した ID トークンを返すので、アプリは本番と同じ手順 (PKCE、state、nonce、署名の検証) を通る。
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createCourseStore, createSubjectStore, openDatabase, type Database } from '@funmary/db';
import {
	startMockOidcServer,
	type MockOidcServer,
} from '../../../packages/auth/src/testing/mock-oidc-server.ts';
import { E2E_DATA_DIR } from '../e2e-data-dir.ts';
import { OIDC_PORT } from '../oidc-port.ts';

// サーバーの状態 (次にログインする人) を共有するので、テストは 1 つずつ動かす
test.describe.configure({ mode: 'serial' });

let oidc: MockOidcServer;

test.beforeAll(async () => {
	oidc = await startMockOidcServer({
		clientId: 'e2e.apps.googleusercontent.com',
		clientSecret: 'e2e-client-secret',
		port: OIDC_PORT,
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
		'次の授業と教室が、開いてすぐ分かる。',
	);
	await page.getByRole('link', { name: 'アプリを開く' }).click();
	await expect(page).toHaveURL('/app');

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

		// ローマ数字を II と打っても見つかる
		await page.getByRole('searchbox').fill('架空の演習II');
		await page.getByRole('button', { name: '探す' }).click();
		const found = page.getByRole('region', { name: '科目を探す' }).getByRole('listitem');
		await expect(found).toHaveCount(1);
		await expect(found).toContainText('後期、架空 一郎');
		await found.getByRole('button', { name: '登録する' }).click();
		await expect(page.getByRole('status')).toHaveText('架空の演習Ⅱ1-AB を履修科目に登録しました。');

		const registered = page
			.getByRole('region', { name: '登録した科目' })
			.getByRole('listitem')
			.filter({ hasText: '架空の演習Ⅱ1-AB' });
		await expect(registered).toContainText('曜日と時限が、まだ登録されていません');

		await registered.getByText('曜日と時限を登録する').click();
		await registered.getByLabel('曜日').selectOption('火曜');
		await registered.getByLabel('時限').selectOption('3 限');
		await registered.getByLabel('教室').fill(' 363 ');
		await registered.getByRole('button', { name: '登録する' }).click();
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
			.getByRole('region', { name: '登録した科目' })
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

	test('ない科目の詳細は、見つからないと出す', async ({ page }) => {
		await loginAs(page);
		// 授業の URL は /app/subjects/<年度>/<シラバスの番号>。前の形 (DB の ID) は転送しない
		for (const path of ['2026/999999', '26/900001', '2026/..%2Fx', '1']) {
			const response = await page.goto(`/app/subjects/${path}`);
			expect(response?.status()).toBe(404);
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
		const logout = menu.getByRole('button', { name: 'ログアウト' });
		const show = menu.getByRole('button', { name: /^メールアドレスを/ });

		// 画面の色のボタンは、表示名が変わっても同じ大きさ。ログアウトのボタンとも同じ大きさ
		const first = await toggle.boundingBox();
		for (let i = 0; i < 3; i++) {
			await toggle.click();
			expect(await toggle.boundingBox()).toEqual(first);
		}
		const logoutBox = await logout.boundingBox();
		expect([logoutBox?.width, logoutBox?.height]).toEqual([first?.width, first?.height]);

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

		// スマホの幅では、上部の 2 つのボタンは同じ 48px 四方
		await page.setViewportSize({ width: 412, height: 915 });
		const header = page.getByRole('banner');
		for (const button of [
			header.getByRole('button', { name: /^画面の色/ }),
			header.getByRole('button', { name: 'ログアウト' }),
		]) {
			const box = await button.boundingBox();
			expect([box?.width, box?.height]).toEqual([48, 48]);
		}
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
		await noClass.getByRole('button', { name: /^消す/ }).click();
		await expect(page.getByRole('status')).toHaveText('全学の休講日を消しました。');
		await expect(noClass.getByText('ありません。')).toBeVisible();
		await substitute.getByRole('button', { name: /^消す/ }).click();
		await expect(page.getByRole('status')).toHaveText('振替授業日を消しました。');
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
		await expect(page).toHaveURL('/app/invites');
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
		await memberPage.goto('/app/invites');
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

		await memberPage.goto('/app/invites');
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

		await page.getByRole('button', { name: '無効にする' }).click();
		await expect(page.getByRole('status').first()).toHaveText(/購読の URL を無効にしました/);
		expect((await page.request.get(second)).status()).toBe(404);
		await expect(page.getByRole('button', { name: '購読の URL を発行する' })).toBeVisible();
	});
});
