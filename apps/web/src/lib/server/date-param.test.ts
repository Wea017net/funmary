import { describe, expect, it } from 'vitest';
import { parseDateParam } from './date-param.ts';

describe('parseDateParam', () => {
	it('暦にある日付は、そのまま返す', () => {
		expect(parseDateParam('2026-10-05')).toBe('2026-10-05');
		expect(parseDateParam('2028-02-29')).toBe('2028-02-29');
	});

	it('暦にない日付、形の違うもの、ないものは null', () => {
		for (const value of ['2026-02-30', '2026-13-01', '2026-1-5', '20261005', 'today', '', null]) {
			expect(parseDateParam(value)).toBeNull();
		}
	});
});
