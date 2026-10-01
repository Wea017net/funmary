import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// パッケージごとの設定 (vitest.config.js) を 1 回の実行にまとめる
export default defineConfig({
	test: {
		projects: [
			'packages/*',
			{
				// GitHub Actions から呼ぶスクリプトの、判断の部分を試す
				test: {
					name: 'scripts',
					include: ['scripts/**/*.test.js'],
					environment: 'node',
				},
			},
			{
				// 外部の人の PR で、ライセンスへの同意を求める Worker (Issue #235)。判断と署名を Node.js で試す (Web Crypto は Node.js にもある)
				test: {
					name: 'license-agreement',
					root: 'apps/license-agreement',
					include: ['src/**/*.test.ts'],
					environment: 'node',
				},
			},
			{
				// SvelteKit の Vite プラグインは作業ディレクトリを基準にするので、ここでは読み込まない。
				// .svelte のコンポーネントを試すときは @sveltejs/vite-plugin-svelte を足す
				resolve: {
					alias: { $lib: fileURLToPath(new URL('apps/web/src/lib', import.meta.url)) },
				},
				test: {
					name: 'web',
					root: 'apps/web',
					include: ['src/**/*.test.ts'],
					environment: 'node',
				},
			},
		],
	},
});
