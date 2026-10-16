import { describe, expect, it } from 'vitest';
import { chooseBusStopId, defaultBusDirection } from './bus-selection.ts';

describe('chooseBusStopId', () => {
	const stops = ['11003', '14013', '15001'];

	it('覚えているバス停が選べるなら、それを使う', () => {
		expect(chooseBusStopId('15001', stops)).toBe('15001');
	});

	it('覚えていない、または選べなくなったときは、既定の亀田支所前にする', () => {
		expect(chooseBusStopId(undefined, stops)).toBe('14013');
		expect(chooseBusStopId('99999', stops)).toBe('14013');
	});

	it('既定のバス停もなければ、一覧の先頭。一覧が空なら null', () => {
		expect(chooseBusStopId(undefined, ['11003', '15001'])).toBe('11003');
		expect(chooseBusStopId(undefined, [])).toBeNull();
	});
});

describe('defaultBusDirection', () => {
	const ranges = ['203.0.113.0/24'];

	it('学内の接続元なら未来大から出る向き、それ以外は未来大へ向かう向き', () => {
		expect(defaultBusDirection(() => '203.0.113.9', ranges)).toEqual({
			direction: 'fromUniversity',
			onCampus: true,
		});
		expect(defaultBusDirection(() => '198.51.100.1', ranges)).toEqual({
			direction: 'toUniversity',
			onCampus: false,
		});
	});

	it('範囲がない、または接続元を読めないときは、未来大へ向かう向き', () => {
		expect(defaultBusDirection(() => '203.0.113.9', [])).toMatchObject({ onCampus: false });
		expect(
			defaultBusDirection(() => {
				throw new Error('読めない');
			}, ranges),
		).toEqual({ direction: 'toUniversity', onCampus: false });
	});
});
