// Google のログインの通し (設計書 21 章)。Google の代わりに、テスト用の OpenID Connect のサーバーを使う。
// サーバーは本物の RS256 で署名した ID トークンを返すので、アプリは本番と同じ手順 (PKCE、state、nonce、署名の検証) を通る。
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createSubjectStore, openDatabase, type Database } from '@funmary/db';
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
	await expect(page.getByRole('link', { name: 'ログイン' })).toBeVisible();
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

	await expect(page).toHaveURL('/');
	await expect(page.getByText('taro@fun.ac.jp でログインしています')).toBeVisible();

	// セッションは HttpOnly の Cookie で、画面の JavaScript から読めない
	const cookies = await page.context().cookies();
	const session = cookies.find((c) => c.name === 'funmary_session');
	expect(session?.httpOnly).toBe(true);
	expect(session?.sameSite).toBe('Lax');
	expect(await page.evaluate(() => document.cookie)).not.toContain('funmary_session');

	// ログイン済みなら、ログインの画面は開かず、トップページに戻る
	await page.goto('/login');
	await expect(page).toHaveURL('/');

	await page.getByRole('button', { name: 'ログアウト' }).click();
	await expect(page).toHaveURL('/');
	await expect(page.getByRole('link', { name: 'ログイン' })).toBeVisible();
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
		await expect(page).toHaveURL('/');
	};

	test('ログインしていなければ、ログインの画面に移る', async ({ page }) => {
		await page.goto('/courses/import');
		await expect(page).toHaveURL('/login');
	});

	test('使い方と、自動では取れないため利用者どうしで登録している旨、ブックマークレットを出す', async ({
		page,
	}) => {
		await loginAs(page);
		await page.goto('/courses/import');
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
		await page.goto(`/courses/import#${payload}`);
		await expect(page.getByRole('button', { name: '取り込む' })).toBeVisible();
		expect(new URL(page.url()).hash).toBe('');
		await page.getByRole('button', { name: '取り込む' }).click();
		await expect(page.getByText('読み取ったコマ: 1 件')).toBeVisible();
		// まだシラバスを取り込んでいない科目は、登録しない
		await expect(page.getByText('まだ Funmary に取り込まれていない科目: 1 件')).toBeVisible();
	});

	test('壊れた内容は、取り込まずに理由を出す', async ({ page }) => {
		await loginAs(page);
		await page.goto('/courses/import#AAAA');
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
		await expect(page).toHaveURL('/');
	};

	test('ログインしていなければ、ログインの画面に移る', async ({ page }) => {
		await page.goto('/courses');
		await expect(page).toHaveURL('/login');
	});

	test('科目を探して登録し、曜日と時限を足し、登録を取り消せる', async ({ page }) => {
		await loginAs(page);
		await page.getByRole('link', { name: '履修科目' }).click();
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
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('架空の演習Ⅱ1-AB');
		await expect(page.getByText('2026 年度 後期')).toBeVisible();
		await expect(page.getByText('火曜 3 限、363')).toBeVisible();
		const changes = page.getByRole('region', { name: '休講、補講、教室変更' });
		await expect(changes).toContainText('休講 2026-10-06 3 限、補講あり');
		await expect(page.getByText('架空の演習の概要です。')).toBeVisible();
		await expect(page.getByRole('link', { name: 'シラバスの原文 (大学のサイト)' })).toHaveAttribute(
			'href',
			'https://syllabus.example.com/900001',
		);
		await page.getByRole('link', { name: '履修科目' }).click();

		await registered.getByRole('button', { name: '登録を取り消す' }).click();
		await expect(page.getByRole('status')).toHaveText('架空の演習Ⅱ1-AB の登録を取り消しました。');
		await expect(page.getByText('まだ登録していません')).toBeVisible();
	});

	test('ない科目の詳細は、見つからないと出す', async ({ page }) => {
		await loginAs(page);
		for (const id of ['999999999', 'abc']) {
			const response = await page.goto(`/subjects/${id}`);
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
						ON CONFLICT DO UPDATE SET resolved_subject_id = NULL`,
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
		await expect(page).toHaveURL('/');
	};

	test('管理者でなければ、管理画面は見つからないことにする', async ({ page }) => {
		await loginAs(page, 'e2e-not-admin@fun.ac.jp');
		await expect(page.getByRole('link', { name: '管理', exact: true })).toHaveCount(0);
		const response = await page.goto('/admin/lessons');
		expect(response?.status()).toBe(404);
	});

	test('照合できなかった授業名を、候補の科目に紐付けられる', async ({ page }) => {
		await loginAs(page, 'e2e-admin@fun.ac.jp');
		await page.getByRole('link', { name: '管理', exact: true }).click();
		await page.getByRole('link', { name: '照合できなかった授業名' }).click();

		const lesson = page.getByRole('listitem').filter({ hasText: '架空の演習Ⅱ (再)' });
		await lesson.getByRole('radio', { name: /架空の演習Ⅱ1-AB \(900001、後期\)/ }).check();
		await lesson.getByRole('button', { name: '紐付ける' }).click();
		await expect(page.getByRole('status')).toHaveText(
			'架空の演習Ⅱ (再) を 架空の演習Ⅱ1-AB に紐付けました (休講などの 1 件に科目を入れました)。',
		);
		await expect(page.getByRole('heading', { name: '架空の演習Ⅱ (再)' })).toHaveCount(0);
	});
});
