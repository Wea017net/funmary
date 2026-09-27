import { INITIAL_SOURCE_HEALTH, type SourceHealth } from '@funmary/core';
import { createLogger } from '@funmary/log';
import type { FetchHolidaysResult } from '@funmary/sources';
import { describe, expect, it, vi } from 'vitest';
import {
	createImportHolidaysJob,
	HOLIDAYS_SOURCE,
	type ImportHolidaysDeps,
} from './import-holidays.ts';
import type { JobContext } from './runner.ts';

const NOW = new Date('2026-09-28T19:00:00Z');

/** 1 年分ほどの、架空ではない形の祝日 (件数の検査を通る数) */
const holidays = Array.from({ length: 20 }, (_, i) => ({
	date: `2027-${String((i % 12) + 1).padStart(2, '0')}-${String(10 + Math.floor(i / 12)).padStart(2, '0')}`,
	name: `祝日${i}`,
}));

function setup(options: { result?: FetchHolidaysResult; health?: SourceHealth } = {}) {
	let health = options.health ?? INITIAL_SOURCE_HEALTH;
	const replaced: { source: string; count: number }[] = [];
	const alerts: { title: string }[] = [];
	const fetchHolidays = vi.fn<ImportHolidaysDeps['fetchHolidays']>(() =>
		Promise.resolve(options.result ?? { kind: 'updated', holidays, skipped: 0, etag: null }),
	);
	const deps: ImportHolidaysDeps = {
		fetchHolidays,
		disabledSources: [],
		health: {
			load: () => health,
			save: (_source, next) => {
				health = next;
			},
		},
		holidays: {
			replaceAll: (source, items) => {
				replaced.push({ source, count: items.length });
			},
		},
		alert: (alert) => {
			alerts.push(alert);
			return Promise.resolve();
		},
	};
	const context: JobContext = {
		signal: new AbortController().signal,
		now: () => NOW,
		log: createLogger({ level: 'error', format: 'text', mode: 'development' }),
	};
	return {
		job: createImportHolidaysJob(deps),
		deps,
		context,
		fetchHolidays,
		replaced,
		alerts,
		health: () => health,
	};
}

describe('祝日の定期処理', () => {
	it('週に 1 回、月曜の日本時間 4 時に動く', () => {
		const { job } = setup();
		expect(job.name).toBe('import-holidays');
		expect(job.schedule).toBe('0 4 * * 1');
	});

	it('内閣府の CSV の祝日で、保存されている祝日を入れ替える', async () => {
		const t = setup();
		const message = await t.job.run(t.context);
		expect(t.replaced).toEqual([{ source: 'cabinetOffice', count: 20 }]);
		expect(t.health().lastSuccessAt).toEqual(NOW);
		expect(message).toContain('20 件');
	});

	it('前回と同じ内容なら、入れ替えない', async () => {
		const first = setup();
		await first.job.run(first.context);
		const t = setup({ health: { ...first.health(), nextAttemptAt: null } });
		const message = await t.job.run(t.context);
		expect(t.replaced).toEqual([]);
		expect(message).toContain('変わっていません');
	});

	it('件数が少なすぎれば、壊れた内容とみなして入れ替えず、管理者に知らせる', async () => {
		const t = setup({
			result: { kind: 'updated', holidays: holidays.slice(0, 3), skipped: 0, etag: null },
		});
		await expect(t.job.run(t.context)).rejects.toThrow('少なすぎ');
		expect(t.replaced).toEqual([]);
		expect(t.alerts).toHaveLength(1);
	});

	it('取得に失敗したら、失敗を数えて例外にする。保存された祝日は残す', async () => {
		const t = setup({ result: { kind: 'failed', message: '通信できませんでした' } });
		await expect(t.job.run(t.context)).rejects.toThrow('通信できませんでした');
		expect(t.health().consecutiveFailures).toBe(1);
		expect(t.replaced).toEqual([]);
	});

	it('取得元が無効にされていたら、何もしない', async () => {
		const t = setup();
		t.job = createImportHolidaysJob({ ...t.deps, disabledSources: [HOLIDAYS_SOURCE] });
		const message = await t.job.run(t.context);
		expect(t.fetchHolidays).not.toHaveBeenCalled();
		expect(message).toContain('無効');
	});
});
