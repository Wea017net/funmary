import { expect, test } from '@playwright/test';

// E2E のサーバーは、だれでも登録できる設定 (REGISTRATION=open) で動かしている
test('ログインしていなければ、アプリの紹介と、はじめる入口を出す', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(
		'次の授業と教室が、開いてすぐ分かる。',
	);
	await expect(page.getByRole('link', { name: '大学のアカウントではじめる' })).toHaveAttribute(
		'href',
		'/auth/google',
	);
	// 招待コードの欄は、招待制のときだけ出す
	await expect(page.getByLabel('はじめての方は、招待コードで登録します')).toHaveCount(0);
	await expect(page.getByRole('region', { name: 'できること' }).getByRole('listitem')).toHaveCount(
		5,
	);
	await expect(page.getByText('準備中:')).toBeVisible();
	await expect(page.getByText('公式のアプリではありません').first()).toBeVisible();
	// 画面の色のボタンは上部に置く
	await expect(page.getByRole('banner').getByRole('button', { name: /^画面の色/ })).toBeVisible();
});
