import { describe, expect, it } from 'vitest';
import { parseWeekView, WEEK_VIEW_COOKIE } from './week-view.ts';

describe('parseWeekView', () => {
	it('1 日ずつと週だけを読み、ほかは自動にする', () => {
		expect(parseWeekView('day')).toBe('day');
		expect(parseWeekView('week')).toBe('week');
		for (const value of [undefined, '', 'auto', 'WEEK', '"><script>']) {
			expect(parseWeekView(value)).toBe('auto');
		}
	});
});

describe('WEEK_VIEW_COOKIE', () => {
	it('Cookie の名前は英数字とハイフンだけにする', () => {
		expect(WEEK_VIEW_COOKIE).toMatch(/^[a-z-]+$/);
	});
});
