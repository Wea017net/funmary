// 画面と API の応答時間 (サーバーの中の処理時間) の、直近 24 時間の分布 (設計書の目標: 95% が 100 ms 以内)。
// サーバーのメモリにだけ持ち、再起動すると消える (2026-10-02、作者の判断)。1 時間ごとに区間ごとの件数だけを持つ
/** 区間の上限 (ms)。最後の上限を超えたものは、最後の区間 (上限なし) に入る */
export const RESPONSE_TIME_BUCKETS = [10, 25, 50, 100, 250, 500, 1000, 2500] as const;

/** 目標の応答時間 (ms) */
export const RESPONSE_TIME_TARGET_MS = 100;

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_HOURS = 24;

export interface ResponseTimeSummary {
	readonly count: number;
	/** 目標以内の割合 (0 から 1)。記録がなければ null */
	readonly withinTarget: number | null;
	/** 分位が入る区間の上限 (ms)。上限のない区間に入れば null */
	readonly p50: number | null;
	readonly p95: number | null;
	readonly p99: number | null;
	/** upTo が null の区間は、上限なし */
	readonly buckets: readonly { readonly upTo: number | null; readonly count: number }[];
}

export interface ResponseTimes {
	record(ms: number, at: Date): void;
	summary(now: Date): ResponseTimeSummary;
}

const bucketOf = (ms: number) => {
	const index = RESPONSE_TIME_BUCKETS.findIndex((upTo) => ms <= upTo);
	return index === -1 ? RESPONSE_TIME_BUCKETS.length : index;
};

export function createResponseTimes(): ResponseTimes {
	/** 1 時間の区切りの始まり (ms) → 区間ごとの件数 */
	const hours = new Map<number, number[]>();

	const oldestKept = (now: Date) =>
		Math.floor(now.getTime() / HOUR_MS) * HOUR_MS - (WINDOW_HOURS - 1) * HOUR_MS;

	const prune = (now: Date) => {
		const oldest = oldestKept(now);
		for (const hour of hours.keys()) if (hour < oldest) hours.delete(hour);
	};

	return {
		record(ms, at) {
			const hour = Math.floor(at.getTime() / HOUR_MS) * HOUR_MS;
			let counts = hours.get(hour);
			if (!counts) {
				prune(at);
				counts = Array.from({ length: RESPONSE_TIME_BUCKETS.length + 1 }, () => 0);
				hours.set(hour, counts);
			}
			counts[bucketOf(ms)] += 1;
		},
		summary(now) {
			prune(now);
			const totals = Array.from({ length: RESPONSE_TIME_BUCKETS.length + 1 }, () => 0);
			for (const counts of hours.values()) {
				counts.forEach((count, index) => (totals[index] += count));
			}
			const count = totals.reduce((sum, value) => sum + value, 0);
			const quantile = (q: number): number | null => {
				if (count === 0) return null;
				const rank = Math.ceil(q * count);
				let seen = 0;
				for (const [index, value] of totals.entries()) {
					seen += value;
					if (seen >= rank) return RESPONSE_TIME_BUCKETS[index] ?? null;
				}
				return null;
			};
			const targetIndex = RESPONSE_TIME_BUCKETS.indexOf(RESPONSE_TIME_TARGET_MS);
			const within = totals.slice(0, targetIndex + 1).reduce((sum, value) => sum + value, 0);
			return {
				count,
				withinTarget: count === 0 ? null : within / count,
				p50: quantile(0.5),
				p95: quantile(0.95),
				p99: quantile(0.99),
				buckets: totals.map((value, index) => ({
					upTo: RESPONSE_TIME_BUCKETS[index] ?? null,
					count: value,
				})),
			};
		},
	};
}
