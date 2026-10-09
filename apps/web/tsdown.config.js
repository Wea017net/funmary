import { builtinModules } from 'node:module';
import { defineConfig } from 'tsdown';
import { BUILD_ALIASES, UNBUNDLED_DEPS } from './bundled-deps.js';

// 管理用コマンド (cli.js) と、本番の入口 (server.js) を、本番で node だけで動かせる JavaScript にまとめる。
// better-sqlite3 は C++ の拡張なので同梱せず、リリースの package.json から入れる
export default defineConfig({
	entry: { cli: 'src/cli.ts', server: 'src/server.ts' },
	format: 'esm',
	platform: 'node',
	target: 'node24',
	outDir: 'dist',
	clean: true,
	// 拡張子は .js にする。package.json の type が module なので ESM として動く
	fixedExtension: false,
	// better-sqlite3 のほかは、dependencies にあるものも含めてすべて同梱する
	deps: {
		alwaysBundle: (id) =>
			!id.startsWith('node:') &&
			!builtinModules.includes(id) &&
			!UNBUNDLED_DEPS.some((name) => id === name || id.startsWith(`${name}/`)),
	},
	// あれば使うだけの依存 (zlib-sync) は、空の部品に置き換える
	alias: BUILD_ALIASES,
	// 依存の版はリリースで固定するので、宣言ファイルは要らない
	dts: false,
});
