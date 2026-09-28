// 本番のビルドに同梱しない依存。C++ の拡張なので同梱できず、リリースの package.json から VPS に入れる (設計書 5.1)。
// ほかの依存は dependencies に置いても、vite.config.js と tsdown.config.js の設定で、すべてビルドに同梱する
export const UNBUNDLED_DEPS = ['better-sqlite3'];
