import { describe, expect, it } from 'vitest';
import {
	addRegisteredRange,
	campusRanges,
	describeAddress,
	parseCurrentAddressForm,
	parseRangeForm,
	readRegisteredRanges,
	removeRegisteredRange,
	type RegisteredRange,
} from './campus-networks.ts';

const NOW = new Date('2026-10-16T00:00:00Z');

const registered = (overrides: Partial<RegisteredRange> = {}): RegisteredRange => ({
	id: 'r1',
	range: '202.231.20.0/24',
	label: null,
	createdAt: '2026-10-15T00:00:00.000Z',
	...overrides,
});

const form = (entries: Record<string, string>) => {
	const data = new FormData();
	for (const [key, value] of Object.entries(entries)) data.append(key, value);
	return data;
};

describe('登録した範囲の読み取り', () => {
	it('形の合うものだけを読む。壊れた値は空にする', () => {
		expect(
			readRegisteredRanges([registered(), { range: 1 }, registered({ range: 'bad' })]),
		).toEqual([registered()]);
		expect(readRegisteredRanges('壊れた値')).toEqual([]);
		expect(readRegisteredRanges(null)).toEqual([]);
	});
});

describe('学内として扱う範囲', () => {
	it('環境変数と登録の範囲を合わせ、重複を除く', () => {
		const list = [registered(), registered({ id: 'r2', range: '198.51.100.7' })];
		expect(campusRanges(['203.0.113.0/24', '202.231.20.0/24'], list)).toEqual([
			'203.0.113.0/24',
			'202.231.20.0/24',
			'198.51.100.7',
		]);
		expect(campusRanges([], [])).toEqual([]);
	});
});

describe('いまのアドレスが登録済みか', () => {
	it('登録した範囲に入るなら、その範囲と登録を返す', () => {
		expect(describeAddress('202.231.20.252', [], [registered()])).toEqual({
			ipv4: '202.231.20.252',
			match: { range: '202.231.20.0/24', source: 'registered', id: 'r1' },
		});
	});

	it('環境変数の範囲に入るなら、環境変数のものとして返す', () => {
		expect(describeAddress('203.0.113.9', ['203.0.113.0/24'], [])).toEqual({
			ipv4: '203.0.113.9',
			match: { range: '203.0.113.0/24', source: 'env', id: null },
		});
	});

	it('どちらにも入らなければ、match は null', () => {
		expect(describeAddress('153.231.86.118', ['203.0.113.0/24'], [registered()]).match).toBeNull();
	});

	it('IPv6 は、IPv4 でないので ipv4 が null。IPv4 を包んだ形は IPv4 として扱う', () => {
		expect(describeAddress('2001:db8::1', [], [registered()])).toEqual({ ipv4: null, match: null });
		expect(describeAddress('::ffff:202.231.20.252', [], [registered()]).ipv4).toBe(
			'202.231.20.252',
		);
	});
});

describe('範囲の追加と削除', () => {
	it('新しいものを先頭に足し、id と日時を付ける', () => {
		const result = addRegisteredRange(
			[registered()],
			[],
			{ range: '198.51.100.7', label: '研究棟' },
			NOW,
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toHaveLength(2);
		expect(result.value[0]).toMatchObject({
			range: '198.51.100.7',
			label: '研究棟',
			createdAt: '2026-10-16T00:00:00.000Z',
		});
		expect(result.value[0]?.id).not.toBe('r1');
		expect(result.value[1]).toEqual(registered());
	});

	it('すでに登録した範囲と、環境変数にある範囲は、重ねて足さない', () => {
		const again = addRegisteredRange(
			[registered()],
			[],
			{ range: '202.231.20.0/24', label: null },
			NOW,
		);
		expect(again).toEqual({ ok: false, error: 'この範囲は、すでに登録してあります。' });
		const inEnv = addRegisteredRange(
			[],
			['203.0.113.5/24'],
			{ range: '203.0.113.0/24', label: null },
			NOW,
		);
		expect(inEnv.ok).toBe(false);
	});

	it('登録できる数に上限がある', () => {
		const full = Array.from({ length: 50 }, (_, i) =>
			registered({ id: `r${i}`, range: `10.0.${i}.0/24` }),
		);
		const result = addRegisteredRange(full, [], { range: '198.51.100.7', label: null }, NOW);
		expect(result.ok).toBe(false);
	});

	it('id を指定して削除する', () => {
		const list = [registered(), registered({ id: 'r2', range: '198.51.100.7' })];
		expect(removeRegisteredRange(list, 'r1').map((r) => r.id)).toEqual(['r2']);
		expect(removeRegisteredRange(list, 'none')).toEqual(list);
	});
});

describe('範囲を手で入れるフォーム', () => {
	it('範囲をそろえた形にして、メモの前後の空白を除く。空のメモは null', () => {
		expect(parseRangeForm(form({ range: ' 202.231.20.9/24 ', label: ' 本館 ' }))).toEqual({
			ok: true,
			value: { range: '202.231.20.0/24', label: '本館' },
		});
		expect(parseRangeForm(form({ range: '203.0.113.7', label: ' ' }))).toEqual({
			ok: true,
			value: { range: '203.0.113.7', label: null },
		});
	});

	it('範囲として読めないもの、広すぎるもの、長すぎるメモは受け付けない', () => {
		expect(parseRangeForm(form({ range: 'abc' })).ok).toBe(false);
		expect(parseRangeForm(form({ range: '0.0.0.0/0' })).ok).toBe(false);
		expect(parseRangeForm(form({ range: '203.0.113.7', label: 'あ'.repeat(101) })).ok).toBe(false);
		expect(parseRangeForm(new FormData()).ok).toBe(false);
	});
});

describe('いまのアドレスを登録するフォーム', () => {
	it('そのアドレスだけ (32) か、同じ /24 (24) を登録する', () => {
		expect(parseCurrentAddressForm(form({ bits: '32' }), '202.231.20.252')).toEqual({
			ok: true,
			value: { range: '202.231.20.252', label: null },
		});
		expect(parseCurrentAddressForm(form({ bits: '24' }), '202.231.20.252')).toEqual({
			ok: true,
			value: { range: '202.231.20.0/24', label: null },
		});
	});

	it('32 と 24 以外の長さ、IPv4 でないアドレスは受け付けない', () => {
		expect(parseCurrentAddressForm(form({ bits: '16' }), '202.231.20.252').ok).toBe(false);
		expect(parseCurrentAddressForm(form({}), '202.231.20.252').ok).toBe(false);
		expect(parseCurrentAddressForm(form({ bits: '32' }), '2001:db8::1').ok).toBe(false);
	});
});
