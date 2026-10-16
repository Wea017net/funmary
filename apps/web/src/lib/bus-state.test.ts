import { describe, expect, it } from 'vitest';
import { BUS_DAY_COOKIE, parseBusDay, secondsUntilJstMidnight } from './bus-state.ts';

describe('parseBusDay', () => {
	it('平日と休日だけを読み、ほかは null にする', () => {
		expect(parseBusDay('weekday')).toBe('weekday');
		expect(parseBusDay('holiday')).toBe('holiday');
		for (const value of [undefined, '', 'WEEKDAY', 'today', '"><script>']) {
			expect(parseBusDay(value)).toBeNull();
		}
	});
});

describe('secondsUntilJstMidnight', () => {
	it('日本時間の次の 0 時までの秒数を返す', () => {
		// 日本時間 2026-10-16 23:00 (UTC 14:00) の 1 時間後が 0 時
		expect(secondsUntilJstMidnight(new Date('2026-10-16T14:00:00Z'))).toBe(3600);
		// 日本時間 2026-10-16 00:00:00 ちょうどは、丸 1 日後
		expect(secondsUntilJstMidnight(new Date('2026-10-15T15:00:00Z'))).toBe(86_400);
	});

	it('日付をまたぐ直前でも、1 秒以上を返す', () => {
		expect(secondsUntilJstMidnight(new Date('2026-10-16T14:59:59.500Z'))).toBe(1);
	});
});

describe('BUS_DAY_COOKIE', () => {
	it('Cookie の名前は英数字とハイフンだけにする', () => {
		expect(BUS_DAY_COOKIE).toMatch(/^[a-z-]+$/);
	});
});
