import { describe, expect, it } from 'vitest';
import { formatSlot, formatTerm, WEEKDAY_LABELS } from './term-label.ts';

describe('formatTerm', () => {
	it('学期を画面の表記にする', () => {
		expect(formatTerm('spring')).toBe('前期');
		expect(formatTerm('q3')).toBe('3Q');
		expect(formatTerm('winter-intensive')).toBe('冬期集中');
	});

	it('知らない値は、そのまま出す', () => {
		expect(formatTerm('unknown')).toBe('unknown');
	});
});

describe('formatSlot', () => {
	it('曜日と時限を 1 つの表記にする', () => {
		expect(formatSlot({ weekday: 1, period: 2 })).toBe('月曜 2 限');
		expect(formatSlot({ weekday: 6, period: 1 })).toBe('土曜 1 限');
	});
});

describe('WEEKDAY_LABELS', () => {
	it('月曜から土曜までを、ISO 8601 の曜日の番号と組にする', () => {
		expect(WEEKDAY_LABELS.map((w) => w.weekday)).toEqual([1, 2, 3, 4, 5, 6]);
	});
});
