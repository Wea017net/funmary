import { expect, test } from '@playwright/test';

test('トップページにアプリ名と、非公式であることが出る', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1, name: 'Funmary' })).toBeVisible();
	await expect(page.getByText('公式のアプリではありません')).toBeVisible();
});
