import { INITIAL_SOURCE_HEALTH, type SourceHealth } from '@funmary/core';
import { createLogger } from '@funmary/log';
import type { FetchAcademicCalendarResult } from '@funmary/sources';
import { describe, expect, it, vi } from 'vitest';
import {
	ACADEMIC_CALENDAR_SOURCE,
	createImportAcademicCalendarJob,
	type AcademicCalendarImportOutcome,
	type ImportAcademicCalendarDeps,
} from './import-academic-calendar.ts';
import type { JobContext } from './runner.ts';

const NOW = new Date('2026-10-01T20:00:00Z');
const PDF = new TextEncoder().encode('%PDF-1.7 calendar');
const OK: FetchAcademicCalendarResult = {
	kind: 'ok',
	year: 2026,
	url: 'https://www.fun.ac.jp/wp/wp-content/uploads/2026AcademicCalendar.pdf',
	bytes: PDF,
};

function setup(
	options: {
		fetched?: FetchAcademicCalendarResult;
		outcome?: AcademicCalendarImportOutcome;
		health?: SourceHealth;
		disabled?: string[];
		recordOfficialPdf?: ImportAcademicCalendarDeps['recordOfficialPdf'];
	} = {},
) {
	let health = options.health ?? INITIAL_SOURCE_HEALTH;
	let now = NOW;
	const alerts: { severity: string; title: string; message?: string }[] = [];
	const importPdf = vi.fn<ImportAcademicCalendarDeps['importPdf']>(() =>
		Promise.resolve(options.outcome ?? { kind: 'applied', academicYear: 2026, skipped: 0 }),
	);
	const deps: ImportAcademicCalendarDeps = {
		fetchPdf: () => Promise.resolve(options.fetched ?? OK),
		importPdf,
		...(options.recordOfficialPdf ? { recordOfficialPdf: options.recordOfficialPdf } : {}),
		disabledSources: options.disabled ?? [],
		health: {
			load: () => health,
			save: (_source, next) => {
				health = next;
			},
		},
		alert: (alert) => {
			alerts.push(alert);
			return Promise.resolve();
		},
	};
	const context: JobContext = {
		signal: new AbortController().signal,
		now: () => now,
		log: createLogger({ level: 'error', format: 'text', mode: 'development' }),
	};
	return {
		job: createImportAcademicCalendarJob(deps),
		context,
		importPdf,
		alerts,
		health: () => health,
		/** 次の月の実行にする (成功のあとは、次の試行の時刻まで待つため) */
		nextMonth: () => {
			now = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
		},
	};
}

describe('学年暦の定期処理', () => {
	it('取れた PDF の年度と URL を、画面のリンク用に記録する。内容が変わっていなくても記録する', async () => {
		const recorded: { year: number; url: string }[] = [];
		const t = setup({ recordOfficialPdf: (info) => recorded.push(info) });
		await t.job.run(t.context);
		t.nextMonth();
		await t.job.run(t.context);
		expect(recorded).toEqual([
			{ year: 2026, url: OK.kind === 'ok' ? OK.url : '' },
			{ year: 2026, url: OK.kind === 'ok' ? OK.url : '' },
		]);
	});

	it('PDF を取れなかったときは、記録しない', async () => {
		const recorded: unknown[] = [];
		const t = setup({
			fetched: { kind: 'failed', message: '取れません' },
			recordOfficialPdf: (info) => recorded.push(info),
		});
		await expect(t.job.run(t.context)).rejects.toThrow('取れません');
		expect(recorded).toEqual([]);
	});

	it('毎月 1 日の日本時間 5 時に動く', () => {
		const { job } = setup();
		expect(job.name).toBe('import-academic-calendar');
		expect(job.schedule).toBe('0 5 1 * *');
	});

	it('取った PDF を取り込み、管理者に知らせる。同じ内容なら、次は読み取らない', async () => {
		const t = setup();
		await expect(t.job.run(t.context)).resolves.toBe('2026 年度の学年暦を取り込みました');
		expect(t.importPdf).toHaveBeenCalledWith(PDF);
		expect(t.alerts).toMatchObject([
			{ severity: 'info', title: '2026 年度の学年暦を取り込みました' },
		]);
		expect(t.health().contentHash).toMatch(/^[0-9a-f]{64}$/);

		t.nextMonth();
		await expect(t.job.run(t.context)).resolves.toBe('2026 年度の学年暦は変わっていません');
		expect(t.importPdf).toHaveBeenCalledTimes(1);
	});

	it('手で入れた値を上書きしなかった数を、結果に書く', async () => {
		const t = setup({ outcome: { kind: 'applied', academicYear: 2026, skipped: 2 } });
		await expect(t.job.run(t.context)).resolves.toContain('上書きしていません');
	});

	it('読み取りに警告があれば書き込まず、手で取り込むよう知らせる。同じ内容では繰り返さない', async () => {
		const t = setup({
			outcome: { kind: 'has-warnings', warnings: ['10 月の月曜の回数が合いません'] },
		});
		await expect(t.job.run(t.context)).resolves.toContain('取り込みませんでした');
		expect(t.alerts).toHaveLength(1);
		expect(t.alerts[0]).toMatchObject({ severity: 'warn' });
		expect(t.alerts[0]?.message).toContain('10 月の月曜の回数が合いません');
		expect(t.alerts[0]?.message).toContain('「学年暦」の画面');
		t.nextMonth();
		await t.job.run(t.context);
		expect(t.alerts).toHaveLength(1);
	});

	it('読み取れなければ、失敗として記録し、すぐ知らせる', async () => {
		const t = setup({ outcome: { kind: 'invalid', reason: '凡例が見つかりません' } });
		await expect(t.job.run(t.context)).rejects.toThrow('凡例が見つかりません');
		expect(t.alerts).toMatchObject([
			{ severity: 'error', title: '学年暦の PDF の作りが変わりました' },
		]);
		expect(t.health().consecutiveFailures).toBe(1);
	});

	it('取得に失敗したら、手で取り込む案内を付けて失敗として記録する', async () => {
		const t = setup({ fetched: { kind: 'failed', message: 'リンクが見つかりません' } });
		await expect(t.job.run(t.context)).rejects.toThrow(/リンクが見つかりません。設定の管理/);
		expect(t.importPdf).not.toHaveBeenCalled();
	});

	it('SOURCES_DISABLED に入っていれば、取りに行かない', async () => {
		const t = setup({ disabled: [ACADEMIC_CALENDAR_SOURCE] });
		await expect(t.job.run(t.context)).resolves.toContain('無効にされています');
		expect(t.importPdf).not.toHaveBeenCalled();
	});
});
