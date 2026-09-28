import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vite';
import { UNBUNDLED_DEPS } from './bundled-deps.js';

// 単体テストの設定はルートの vitest.config.js に置く
export default defineConfig(({ command }) => ({
	// adapter-node は dependencies をビルドの外に置き、実行時に読み込む。VPS には better-sqlite3 しか入れないので、
	// ビルドでは、ほかの依存をすべて同梱する。開発サーバーでは、読み込みを速くするため同梱しない
	...(command === 'build' && { ssr: { noExternal: true, external: UNBUNDLED_DEPS } }),
	plugins: [
		sveltekit(),
		// 使ったアイコンだけを、ビルド時に SVG の Svelte コンポーネントにして埋め込む (設計書 5.2)
		Icons({ compiler: 'svelte' }),
	],
	css: {
		preprocessorOptions: {
			scss: {
				// コンポーネントの <style lang="scss"> から @use 'breakpoints' で読めるようにする
				loadPaths: [fileURLToPath(new URL('./src/lib/styles', import.meta.url))],
			},
		},
	},
}));
