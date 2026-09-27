import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vite';

// 単体テストの設定はルートの vitest.config.ts に置く
export default defineConfig({
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
});
