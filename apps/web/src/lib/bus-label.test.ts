import { describe, expect, it } from 'vitest';
import { BUS_STALE_AFTER_DAYS, formatMinutesUntil, isBusDataStale } from './bus-label.ts';

describe('formatMinutesUntil', () => {
	it('0 分は「まもなく」、1 時間未満は分、それ以上は時間と分で書く', () => {
		expect(formatMinutesUntil(0)).toBe('まもなく');
		expect(formatMinutesUntil(5)).toBe('あと 5 分');
		expect(formatMinutesUntil(60)).toBe('あと 1 時間');
		expect(formatMinutesUntil(135)).toBe('あと 2 時間 15 分');
	});
});

describe('isBusDataStale', () => {
	const now = new Date('2026-10-10T00:00:00Z');
	const daysAgo = (days: number) =>
		new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

	it('最後に確かめてから、決めた日数を超えたら古いとみなす', () => {
		expect(isBusDataStale(daysAgo(BUS_STALE_AFTER_DAYS - 0.1), now)).toBe(false);
		expect(isBusDataStale(daysAgo(BUS_STALE_AFTER_DAYS + 0.1), now)).toBe(true);
	});

	it('まだ確かめていなければ、古いとはいわない (取り込み前の案内を別に出す)', () => {
		expect(isBusDataStale(null, now)).toBe(false);
	});
});
