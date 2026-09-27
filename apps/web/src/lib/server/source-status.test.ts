import { INITIAL_SOURCE_HEALTH } from '@funmary/core';
import { describe, expect, it } from 'vitest';
import { formatSourcesReport, sourceStatuses } from './source-status.ts';

const NOW = new Date('2026-10-05T03:00:00Z'); // 日本時間の 12:00

describe('sourceStatuses', () => {
	it('知っている取得元は、記録がなくても並べ、日本時間で出す', () => {
		const rows = sourceStatuses([
			{
				source: 'portal',
				health: {
					...INITIAL_SOURCE_HEALTH,
					lastSuccessAt: new Date('2026-10-05T02:00:00Z'),
					lastAttemptAt: new Date('2026-10-05T02:00:00Z'),
				},
			},
		]);
		expect(rows).toEqual([
			{
				source: 'portal',
				label: '学生ポータル (休講など)',
				lastSuccessAt: '2026-10-05 11:00',
				lastAttemptAt: '2026-10-05 11:00',
				nextAttemptAt: null,
				consecutiveFailures: 0,
				lastError: null,
				state: 'ok',
			},
			{
				source: 'syllabus',
				label: '公開シラバス',
				lastSuccessAt: null,
				lastAttemptAt: null,
				nextAttemptAt: null,
				consecutiveFailures: 0,
				lastError: null,
				state: 'never',
			},
			{
				source: 'holidays',
				label: '内閣府の祝日',
				lastSuccessAt: null,
				lastAttemptAt: null,
				nextAttemptAt: null,
				consecutiveFailures: 0,
				lastError: null,
				state: 'never',
			},
		]);
	});

	it('3 回続けて失敗したら不調、それより少なければ失敗ありとする。知らない取得元も出す', () => {
		const failing = (count: number) => ({
			...INITIAL_SOURCE_HEALTH,
			lastAttemptAt: NOW,
			consecutiveFailures: count,
			lastError: 'タイムアウト',
		});
		const rows = sourceStatuses([
			{ source: 'portal', health: failing(3) },
			{ source: 'syllabus', health: failing(1) },
			{ source: 'hope', health: INITIAL_SOURCE_HEALTH },
		]);
		expect(rows.map((row) => [row.source, row.state])).toEqual([
			['portal', 'unhealthy'],
			['syllabus', 'failing'],
			['holidays', 'never'],
			['hope', 'never'],
		]);
		expect(rows[0]?.lastError).toBe('タイムアウト');
	});
});

describe('formatSourcesReport', () => {
	it('取得元ごとに 1 行で出す', () => {
		const rows = sourceStatuses([
			{
				source: 'portal',
				health: {
					...INITIAL_SOURCE_HEALTH,
					lastSuccessAt: new Date('2026-10-05T02:00:00Z'),
					lastAttemptAt: new Date('2026-10-05T02:30:00Z'),
					consecutiveFailures: 1,
					lastError: 'タイムアウト',
				},
			},
		]);
		expect(formatSourcesReport(rows)).toEqual([
			'学生ポータル (休講など) [portal]: 失敗あり。最終成功 2026-10-05 11:00、最終試行 2026-10-05 11:30、連続の失敗 1 回。直近の失敗: タイムアウト',
			'公開シラバス [syllabus]: まだ動いていません',
			'内閣府の祝日 [holidays]: まだ動いていません',
		]);
	});
});
