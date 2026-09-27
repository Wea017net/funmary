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

	await expect(page).toHaveURL('/');
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

	// ログイン済みなら、ログインの画面は開かず、トップページに戻る
	await page.goto('/login');
	await expect(page).toHaveURL('/');

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
		await page
			.getByRole('navigation', { name: 'メニュー' })
			.getByRole('link', { name: '履修科目', exact: true })
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
		await page
			.getByRole('navigation', { name: 'メニュー' })
			.getByRole('link', { name: '履修科目', exact: true })
			.click();

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

test.describe('今日と週の時間割', () => {
	// 手元では DB がテストのたびに消えないので、利用者を毎回変える
	const sub = `e2e-week-${Date.now()}`;
	const email = `${sub}@fun.ac.jp`;

	const loginAs = async (page: import('@playwright/test').Page) => {
		oidc.setIdentity({ sub, email, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		await expect(page).toHaveURL('/');
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
		await page.goto('/week');
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
		await expect(page).toHaveURL('/week');

		await page.goto('/week?date=2026-10-07');
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
		await page.goto('/week?date=2026-10-11');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('10/12 (月) からの週');

		// カレンダーで日付を選ぶと、その日を含む週に移る
		await page.getByRole('button', { name: 'カレンダーで日付を選んで、その週を出す' }).click();
		await page.locator('.picker input[type="date"]').fill('2026-11-04');
		await expect(page).toHaveURL('/week?date=2026-11-04');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('11/2 (月) からの週');
		for (let i = 0; i < 3; i++) await page.getByRole('link', { name: '前の週' }).click();
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('10/12 (月) からの週');

		await table.getByRole('link', { name: '架空の時間割演習' }).first().click();
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('架空の時間割演習');
	});

	test('画面の色は、端末の設定、ライト、ダークの順に切り替わり、読み込み直しても保たれる', async ({
		page,
	}) => {
		await loginAs(page);
		const html = page.locator('html');
		const toggle = page
			.getByRole('navigation', { name: 'メニュー' })
			.getByRole('button', { name: /^画面の色/ });
		await expect(html).toHaveAttribute('data-theme', 'system');
		await expect(toggle).toHaveAccessibleName('画面の色: 端末の設定 (押すとライトに切り替えます)');
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
		await page.goto('/week');
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

	test('暦にない日付の週は、今週に移る', async ({ page }) => {
		await loginAs(page);
		await page.goto('/week?date=2026-02-30');
		await expect(page).toHaveURL('/week');
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
		await expect(page).toHaveURL('/');
	};

	test('管理者でなければ、学年暦の画面は見つからないことにする', async ({ page }) => {
		const email = 'e2e-not-admin@fun.ac.jp';
		oidc.setIdentity({ sub: email, email, email_verified: true, hd: 'fun.ac.jp' });
		await page.goto('/auth/google');
		const response = await page.goto('/admin/calendar');
		expect(response?.status()).toBe(404);
	});

	test('学期の期間、振替授業日、全学の休講日を入れて消せる。入れた値は時間割に使われる', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto('/admin');
		await expect(page.getByText('推定のままです')).toBeVisible();
		await page.goto('/admin/calendar?year=2026');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('2026 年度の学年暦');

		const terms = page.getByRole('region', { name: '学期の期間' });
		await expect(terms.getByRole('row', { name: /^後期/ })).toContainText('推定');

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

		const substitute = page.getByRole('region', { name: '振替授業日' });
		await substitute.getByLabel('日付').fill('2026-10-14');
		await substitute.getByLabel('行う授業の曜日').selectOption('月曜');
		await substitute.getByRole('button', { name: '振替授業日を保存する' }).click();
		await expect(page.getByRole('status')).toHaveText('振替授業日を保存しました。');
		await expect(substitute.getByRole('listitem')).toHaveText(/10\/14 \(水\) は 月曜の授業/);

		const noClass = page.getByRole('region', { name: '全学の休講日' });
		await noClass.getByLabel('日付').fill('2026-10-16');
		await noClass.getByLabel('行事名 (任意)').fill('架空の行事');
		await noClass.getByRole('button', { name: '全学の休講日を保存する' }).click();
		await expect(page.getByRole('status')).toHaveText('全学の休講日を保存しました。');
		await expect(noClass.getByRole('listitem')).toContainText('10/16 (金) (架空の行事)');

		// 週の時間割の日付の横に出る
		await page.goto('/week?date=2026-10-12');
		const headers = page.getByRole('table').getByRole('columnheader');
		await expect(headers.filter({ hasText: '10/14 (水)' })).toContainText('月曜の授業を行う日');
		await expect(headers.filter({ hasText: '10/16 (金)' })).toContainText(
			'全学の休講日 (架空の行事)',
		);

		await page.goto('/admin/calendar?year=2026');
		await noClass.getByRole('button', { name: /^消す/ }).click();
		await expect(page.getByRole('status')).toHaveText('全学の休講日を消しました。');
		await expect(noClass.getByText('ありません。')).toBeVisible();
		await substitute.getByRole('button', { name: /^消す/ }).click();
		await expect(page.getByRole('status')).toHaveText('振替授業日を消しました。');
		await terms.getByRole('row', { name: /^後期/ }).getByRole('button', { name: /^消す/ }).click();
		await expect(page.getByRole('status')).toContainText('学期の期間を消しました。');
		await expect(terms.getByRole('row', { name: /^後期/ })).toContainText('推定');
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
		await page.goto('/admin');
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
		const response = await page.goto('/admin/status');
		expect(response?.status()).toBe(404);
	});
});
