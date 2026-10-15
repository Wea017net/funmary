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

	test('メニューにバスが出て、強調する停留所の次のバスが並ぶ', async ({ page }) => {
		await signInAs(page, email);
		await page.getByRole('link', { name: 'バス', exact: true }).first().click();
		await expect(page.getByRole('heading', { level: 1, name: 'バス' })).toBeVisible();
		await expect(page.getByRole('heading', { level: 2, name: 'はこだて未来大学' })).toBeVisible();
		const first = page.getByRole('listitem').filter({ hasText: '架空の行き先' }).first();
		await expect(first).toContainText('55A');
		await expect(first).toContainText('架空の経由地');
	});

	test('停留所を選ぶと、その停留所の次のバスと時刻表が出る。平日と休日を切り替えられる', async ({
		page,
	}) => {
		await signInAs(page, email);
		await page.goto('/app/bus');
		await page.getByLabel('停留所').selectOption({ label: '函館駅前' });
		await page.getByRole('button', { name: '表示する', exact: true }).click();
		await expect(page).toHaveURL(/stop=11003/);
		await expect(page.getByRole('heading', { level: 2, name: '函館駅前の次のバス' })).toBeVisible();
		await expect(page.getByRole('heading', { level: 2, name: '函館駅前の時刻表' })).toBeVisible();
		await expect(page.getByRole('table')).toBeVisible();
		await expect(page.getByText('△＝架空の注意書き')).toBeVisible();

		await page.getByRole('link', { name: /^土曜・日曜・祝日/ }).click();
		await expect(page).toHaveURL(/day=holiday/);
		await expect(page.getByRole('link', { name: /^土曜・日曜・祝日/ })).toHaveAttribute(
			'aria-current',
			'page',
		);
	});

	test('ログインしていなければ、バスの画面は開けない', async ({ page }) => {
		oidc.setIdentity({ sub: 'nobody', email: 'nobody@fun.ac.jp', email_verified: true });
		await page.context().clearCookies();
		await page.goto('/app/bus');
		await expect(page).not.toHaveURL(/\/app\/bus/);
	});
});
