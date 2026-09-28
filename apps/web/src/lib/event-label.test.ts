import type { Recurrence } from '@funmary/core';
import { describe, expect, it } from 'vitest';
import { describeRecurrence, formatEventTime } from './event-label.ts';

describe('describeRecurrence', () => {
	const never = { kind: 'never' } as const;
	const cases: [Recurrence, string][] = [
		[{ freq: 'daily', interval: 1, end: never }, '毎日'],
		[{ freq: 'daily', interval: 3, end: never }, '3 日ごと'],
		[{ freq: 'weekly', interval: 1, weekdays: [1, 3], end: never }, '毎週 月、水'],
		[{ freq: 'weekly', interval: 2, weekdays: [5], end: never }, '2 週ごと 金'],
		[{ freq: 'monthly', interval: 1, monthly: { by: 'day' }, end: never }, '毎月 (開始日と同じ日)'],
		[
			{ freq: 'monthly', interval: 1, monthly: { by: 'nth', nth: 2, weekday: 2 }, end: never },
			'毎月 第 2 火曜日',
		],
		[
			{ freq: 'monthly', interval: 3, monthly: { by: 'nth', nth: -1, weekday: 5 }, end: never },
			'3 か月ごと 最終金曜日',
		],
		[{ freq: 'yearly', interval: 1, end: never }, '毎年'],
		[{ freq: 'yearly', interval: 2, end: never }, '2 年ごと'],
		[{ freq: 'daily', interval: 1, end: { kind: 'count', count: 5 } }, '毎日、5 回まで'],
		[
			{ freq: 'weekly', interval: 1, weekdays: [1], end: { kind: 'until', date: '2026-12-31' } },
			'毎週 月、2026/12/31 まで',
		],
	];
	it.each(cases)('%j は「%s」', (recurrence, expected) => {
		expect(describeRecurrence(recurrence)).toBe(expected);
	});
});

describe('formatEventTime', () => {
	it('終日、時刻、時限を、それぞれ文にする', () => {
		expect(formatEventTime({ kind: 'allDay' })).toBe('終日');
		expect(formatEventTime({ kind: 'time', start: '18:00', end: '19:30' })).toBe('18:00-19:30');
		expect(formatEventTime({ kind: 'period', from: 2, to: 2 })).toBe('2 限');
		expect(formatEventTime({ kind: 'period', from: 2, to: 3 })).toBe('2 限から 3 限');
	});
});
