import { defineConfig, devices } from '@playwright/test';
import { E2E_DATA_DIR } from './e2e-data-dir.ts';
import { OIDC_PORT } from './oidc-port.ts';
import { generateSecrets } from './src/lib/server/env-file.ts';

const port = 4173;

/** テスト用のサーバーに渡す環境変数。本番と同じ検査を通る形にした架空の値 */
const serverEnv = {
	...generateSecrets(),
	ORIGIN: `http://localhost:${port}`,
	GOOGLE_CLIENT_ID: 'e2e.apps.googleusercontent.com',
	GOOGLE_CLIENT_SECRET: 'e2e-client-secret',
	// Google の代わりに、テスト本体が立てる OpenID Connect のサーバーを使う
	OIDC_ISSUER: `http://127.0.0.1:${OIDC_PORT}`,
	// 大学のアカウントなら誰でも登録できる形にする (招待コードの流れは単体テストで確かめている)
	REGISTRATION: 'open',
	PORTAL_USER_ID: 'e2e-student',
	PORTAL_PASSWORD: 'e2e-password',
	DATA_DIR: E2E_DATA_DIR,
};

export default defineConfig({
	testDir: 'e2e',
	forbidOnly: !!process.env['CI'],
	retries: process.env['CI'] ? 2 : 0,
	reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: `http://localhost:${port}`,
		trace: 'on-first-retry',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: `pnpm build && pnpm preview --port ${port} --strictPort`,
		port,
		// サーバーのログを、テストの出力に混ぜる (失敗の原因を追えるように)
		stdout: 'pipe',
		stderr: 'pipe',
		reuseExistingServer: !process.env['CI'],
		env: serverEnv,
	},
});
