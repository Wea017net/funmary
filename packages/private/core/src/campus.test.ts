import { describe, expect, it } from 'vitest';
import { isInIpRanges, isNearUniversity, UNIVERSITY_LOCATION } from './campus.ts';

describe('isInIpRanges', () => {
	const ranges = ['203.0.113.0/24', '198.51.100.7'];

	it('範囲 (CIDR) と、単独のアドレスの、どちらも判定できる', () => {
		expect(isInIpRanges('203.0.113.55', ranges)).toBe(true);
		expect(isInIpRanges('203.0.114.1', ranges)).toBe(false);
		expect(isInIpRanges('198.51.100.7', ranges)).toBe(true);
		expect(isInIpRanges('198.51.100.8', ranges)).toBe(false);
	});

	it('IPv4 を IPv6 の形に包んだアドレスも、IPv4 として扱う', () => {
		expect(isInIpRanges('::ffff:203.0.113.9', ranges)).toBe(true);
	});

	it('範囲が空、アドレスが読めない、範囲が不正なときは false', () => {
		expect(isInIpRanges('203.0.113.9', [])).toBe(false);
		expect(isInIpRanges('abc', ranges)).toBe(false);
		expect(isInIpRanges('203.0.113.9', ['bad', '203.0.113.0/99'])).toBe(false);
		expect(isInIpRanges('2001:db8::1', ranges)).toBe(false);
	});

	it('/0 はすべてに当たる。/32 は 1 つのアドレス', () => {
		expect(isInIpRanges('8.8.8.8', ['0.0.0.0/0'])).toBe(true);
		expect(isInIpRanges('203.0.113.9', ['203.0.113.9/32'])).toBe(true);
		expect(isInIpRanges('203.0.113.10', ['203.0.113.9/32'])).toBe(false);
	});
});

describe('isNearUniversity', () => {
	it('未来大の近くの現在地は true、離れていれば false', () => {
		expect(isNearUniversity(UNIVERSITY_LOCATION.latitude, UNIVERSITY_LOCATION.longitude)).toBe(
			true,
		);
		// 約 200 m
		expect(
			isNearUniversity(UNIVERSITY_LOCATION.latitude + 0.0018, UNIVERSITY_LOCATION.longitude),
		).toBe(true);
		// 函館駅の近く
		expect(isNearUniversity(41.7737, 140.7266)).toBe(false);
	});

	it('範囲 (メートル) を指定できる', () => {
		const offset = UNIVERSITY_LOCATION.latitude + 0.0045; // 約 500 m
		expect(isNearUniversity(offset, UNIVERSITY_LOCATION.longitude, 300)).toBe(false);
		expect(isNearUniversity(offset, UNIVERSITY_LOCATION.longitude, 800)).toBe(true);
	});

	it('座標が数でなければ false', () => {
		expect(isNearUniversity(Number.NaN, 140.7)).toBe(false);
	});
});
