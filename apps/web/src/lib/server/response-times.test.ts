import { describe, expect, it } from 'vitest';
import { RESPONSE_TIME_BUCKETS, createResponseTimes } from './response-times.ts';

const at = (iso: string) => new Date(iso);

describe('応答時間の記録', () => {
	it('直近 24 時間の件数、目標 (100 ms 以内) の割合、分布を返す', () => {
		const times = createResponseTimes();
		for (const ms of [10, 20, 30, 80, 120, 400]) times.record(ms, at('2026-10-02T09:10:00Z'));
		const summary = times.summary(at('2026-10-02T10:00:00Z'));
		expect(summary.count).toBe(6);
		expect(summary.withinTarget).toBeCloseTo(4 / 6);
		expect(summary.buckets.map((bucket) => bucket.count)).toEqual([1, 1, 1, 1, 1, 1, 0, 0, 0]);
		expect(summary.buckets).toHaveLength(RESPONSE_TIME_BUCKETS.length + 1);
	});

	it('分位 (50%、95%) は、その分位が入る区間の上限で示す', () => {
		const times = createResponseTimes();
		for (let i = 0; i < 95; i++) times.record(5, at('2026-10-02T09:00:00Z'));
		for (let i = 0; i < 5; i++) times.record(3000, at('2026-10-02T09:00:00Z'));
		const summary = times.summary(at('2026-10-02T09:30:00Z'));
		expect(summary.p50).toBe(10);
		expect(summary.p95).toBe(10);
		expect(summary.p99).toBeNull();
	});

	it('直近 24 時間 (今の 1 時間を含む 24 の 1 時間ごとの区切り) より前の記録は数えず、捨てる', () => {
		const times = createResponseTimes();
		times.record(10, at('2026-10-01T08:59:00Z'));
		times.record(10, at('2026-10-01T11:00:00Z'));
		const summary = times.summary(at('2026-10-02T10:30:00Z'));
		expect(summary.count).toBe(1);
	});

	it('記録がなければ、件数 0 で、割合と分位は null', () => {
		const summary = createResponseTimes().summary(at('2026-10-02T10:00:00Z'));
		expect(summary).toMatchObject({ count: 0, withinTarget: null, p50: null, p95: null });
	});
});
