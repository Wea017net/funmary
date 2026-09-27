import { describe, expect, it } from 'vitest';
import { describeClassChange } from './class-change-label.ts';

const base = {
	date: '2026-10-05',
	period: 3,
	room: null,
	fromRoom: null,
	comment: null,
	makeupPlan: null,
	withdrawn: false,
} as const;

describe('describeClassChange', () => {
	it('休講には、補講の予定を添える', () => {
		expect(describeClassChange({ ...base, kind: 'cancellation', makeupPlan: 'planned' })).toEqual({
			label: '休講',
			detail: '補講あり',
		});
		expect(describeClassChange({ ...base, kind: 'cancellation' })).toEqual({
			label: '休講',
			detail: null,
		});
	});

	it('補講には教室を、教室変更には移動元と移動先を添える', () => {
		expect(describeClassChange({ ...base, kind: 'makeup', room: '363' })).toEqual({
			label: '補講',
			detail: '363',
		});
		expect(
			describeClassChange({ ...base, kind: 'roomChange', fromRoom: '401', room: '502' }),
		).toEqual({ label: '教室変更', detail: '401 から 502 へ' });
		expect(describeClassChange({ ...base, kind: 'roomChange', room: '502' })).toEqual({
			label: '教室変更',
			detail: '502 へ',
		});
	});
});
