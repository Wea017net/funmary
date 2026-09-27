// 画面の色 (ライトとダーク) の設定。既定は端末の設定に従い、ボタンでライト、ダークに固定できる。
// 設定は Cookie に置き、サーバーが <html data-theme> に入れて返す (読み込みの直後に色がちらつかないようにするため)

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_COOKIE = 'fm-theme';

/** Cookie の値を読む。知らない値は、端末の設定に従う */
export function parseThemePreference(value: string | undefined): ThemePreference {
	return value === 'light' || value === 'dark' ? value : 'system';
}

const ORDER: readonly ThemePreference[] = ['system', 'light', 'dark'];

/** ボタンを押したときの次の設定。システム、ライト、ダークの順に繰り返す */
export function nextThemePreference(current: ThemePreference): ThemePreference {
	return ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] ?? 'system';
}
