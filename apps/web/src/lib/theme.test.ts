import { describe, expect, it } from 'vitest';
import { nextThemePreference, parseThemePreference, THEME_COOKIE } from './theme.ts';

describe('parseThemePreference', () => {
	it('ライトとダークだけを読み、ほかはシステムの設定に従う', () => {
		expect(parseThemePreference('light')).toBe('light');
		expect(parseThemePreference('dark')).toBe('dark');
		for (const value of [undefined, '', 'system', 'DARK', '"><script>']) {
			expect(parseThemePreference(value)).toBe('system');
		}
	});
});

describe('nextThemePreference', () => {
	it('システム、ライト、ダークの順に繰り返す', () => {
		expect(nextThemePreference('system')).toBe('light');
		expect(nextThemePreference('light')).toBe('dark');
		expect(nextThemePreference('dark')).toBe('system');
	});
});

describe('THEME_COOKIE', () => {
	it('Cookie の名前は英数字とハイフンだけにする', () => {
		expect(THEME_COOKIE).toMatch(/^[a-z-]+$/);
	});
});
