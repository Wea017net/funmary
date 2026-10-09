// スマホの幅で、画面が崩れないこと。
import { expect, test, type Page } from '@playwright/test';
import { REPOSITORY_URL } from '../src/lib/repository.ts';
import { oidc, signIn, useMockOidc, seedSubjects, signInAs } from './support.ts';

// サーバーの状態 (次にログインする人) を共有するので、テストは 1 つずつ動かす
test.describe.configure({ mode: 'serial' });
useMockOidc();

test.describe('スマホの幅で、画面が横にはみ出さない', () => {
	test('主な画面を、スマホの幅 (390px) で開いても、横スクロールが出ない', async ({ page }) => {
		const email = `e2e-overflow-${Date.now()}@fun.ac.jp`;
		oidc.setIdentity({ sub: email, email, email_verified: true, hd: 'fun.ac.jp' });
		await signIn(page);
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
			'/app/settings/feed',
			'/app/settings/invites',
			'/about',
			'/license',
			'/third-party-licenses',
			'/terms',
			'/privacy',
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
		await signIn(page);
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

test.describe('スマホの上部バーと、フッターのリンク', () => {
	const loginAs = (page: Page) => signInAs(page, `e2e-header-${Date.now()}@fun.ac.jp`);

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
		await expect(page.getByRole('link', { name: '利用規約' })).toHaveAttribute('href', '/terms');
		await expect(page.getByRole('link', { name: 'プライバシーポリシー' })).toHaveAttribute(
			'href',
			'/privacy',
		);

		await loginAs(page);
		await expect(page.getByRole('link', { name: 'ソースコード (GitHub)' })).toBeVisible();
	});
});
