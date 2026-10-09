import { fileURLToPath } from 'node:url';

// 本番のビルドに同梱しない依存。C++ の拡張なので同梱できず、リリースの package.json から VPS に入れる。
// ほかの依存は dependencies に置いても、vite.config.js と tsdown.config.js の設定で、すべてビルドに同梱する
export const UNBUNDLED_DEPS = ['better-sqlite3'];

/** ビルドで、別の部品に置き換える依存 (名前 → 置き換え先のファイル)。@discordjs/ws の、あれば使うだけの圧縮ライブラリ */
export const BUILD_ALIASES = {
	'zlib-sync': fileURLToPath(new URL('./stubs/zlib-sync.js', import.meta.url)),
};
