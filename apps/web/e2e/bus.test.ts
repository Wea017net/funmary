// バスの時刻表の画面。時刻表は、取り込みの定期処理の代わりに、テストが DB に直接入れる。
import { expect, test } from '@playwright/test';
import { oidc, seedBus, signInAs, useMockOidc } from './support.ts';

// サーバーの状態 (次にログインする人) を共有するので、テストは 1 つずつ動かす
test.describe.configure({ mode: 'serial' });
useMockOidc();

test.describe('バス', () => {
	const email = `e2e-bus-${Date.now()}@fun.ac.jp`;

	test.beforeAll(() => {
		seedBus();
	});

	test('メニューにバスが出る。選んだバス停から未来大へ向かう便だけが、到着の時刻つきで出る', async ({
		page,
	}) => {
		await signInAs(page, email);
		await page.getByRole('link', { name: 'バス', exact: true }).first().click();
		await expect(page.getByRole('heading', { level: 1, name: 'バス' })).toBeVisible();

		await page.goto('/app/bus?stop=11003&direction=toUniversity');
		await expect(page.getByRole('link', { name: /出発.*函館駅前/ })).toBeVisible();
		const rows = page.getByRole('listitem').filter({ hasText: '55A' });
		await expect(rows.first()).toContainText('赤川行き');
		await expect(rows.first()).toContainText('函館駅前 - はこだて未来大学');
		// 到着の時刻 (出発の 15 分後。未来大の発車表の同じ行き先の便) が付く
		await expect(rows.first()).toContainText('→');
		// 反対向き (千代台行き) は出ない
		await expect(page.getByText('千代台行き')).toHaveCount(0);
		// 事業者の注意書きは、「印の意味」の折りたたみの中
		await page.getByText('印の意味').click();
		await expect(page.getByText('△＝架空の注意書き')).toBeVisible();
		// 現在地から向きを決めるボタンは、URL に向きが付いていても、出ている (PWA には URL の欄がない)
		await expect(page.getByRole('button', { name: '現在地から向きを決める' })).toBeVisible();
	});

	test('向きを入れ替えると、未来大から出る便になる。向きは覚えず、選んだバス停だけを覚える', async ({
		page,
	}) => {
		await signInAs(page, email);
		await page.goto('/app/bus?stop=11003&direction=toUniversity');
		await page.getByRole('link', { name: /向きを入れ替える/ }).click();
		await expect(page).toHaveURL(/direction=fromUniversity/);
		await expect(page.getByRole('link', { name: /到着.*函館駅前/ })).toBeVisible();
		const rows = page.getByRole('listitem').filter({ hasText: '55A' });
		await expect(rows.first()).toContainText('千代台行き');
		await expect(rows.first()).toContainText('はこだて未来大学 - 函館駅前');

		// 何も指定せずに開くと、前回のバス停で、未来大へ向かう向き (学内の Wi-Fi でなければ)
		await page.goto('/app/bus');
		await expect(page.getByRole('link', { name: /出発.*函館駅前/ })).toBeVisible();
	});

	test('バス停の選択の画面から、バス停を選ぶと、バスの画面に戻る', async ({ page }) => {
		await signInAs(page, email);
		await page.goto('/app/bus?stop=11003&direction=toUniversity');
		await page.getByRole('link', { name: /出発.*函館駅前/ }).click();
		await expect(page.getByRole('heading', { level: 1, name: 'バス停選択' })).toBeVisible();
		// 未来大そのものは選べない
		await expect(page.getByRole('link', { name: 'はこだて未来大学' })).toHaveCount(0);
		await page.getByRole('link', { name: '函館駅前' }).click();
		await expect(page).toHaveURL(/\/app\/bus\?stop=11003&direction=toUniversity/);
	});

	test('平日と休日を切り替えられ、今日の区分には (今日) が付く', async ({ page }) => {
		await signInAs(page, email);
		await page.goto('/app/bus?stop=11003&direction=toUniversity');
		await expect(page.getByRole('link', { name: /\(今日\)/ })).toBeVisible();
		await page.getByRole('link', { name: /^休日/ }).click();
		await expect(page).toHaveURL(/day=holiday/);
		await expect(page.getByRole('link', { name: /^休日/ })).toHaveAttribute('aria-current', 'page');
	});

	test('ログインしていなければ、バスの画面は開けない', async ({ page }) => {
		oidc.setIdentity({ sub: 'nobody', email: 'nobody@fun.ac.jp', email_verified: true });
		await page.context().clearCookies();
		await page.goto('/app/bus');
		await expect(page).not.toHaveURL(/\/app\/bus/);
	});
});
