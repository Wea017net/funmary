import { describe, expect, it } from 'vitest';
import { CLASS_CHANGE_KIND_LABELS, WEEKDAY_NAMES } from './labels.ts';

describe('WEEKDAY_NAMES', () => {
	it('ISO の曜日の番号 (1 が月曜から 7 が日曜) で引ける', () => {
		expect(WEEKDAY_NAMES[1]).toBe('月');
		expect(WEEKDAY_NAMES[5]).toBe('金');
		expect(WEEKDAY_NAMES[7]).toBe('日');
		expect(WEEKDAY_NAMES).toHaveLength(8);
	});
});

describe('CLASS_CHANGE_KIND_LABELS', () => {
	it('休講、補講、教室変更の呼び名を持つ', () => {
		expect(CLASS_CHANGE_KIND_LABELS).toEqual({
			cancellation: '休講',
			makeup: '補講',
			roomChange: '教室変更',
		});
	});
});
