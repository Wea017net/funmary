// 内閣府の祝日の CSV を取り込む定期処理 (設計書 9 章、10 章)。週に 1 回取得し、内容が変わったときだけ入れ替える。
// 取得に失敗しても、保存された祝日 (最初は同梱の CSV) と、その先の年の推定で動き続ける。
import { createHash } from 'node:crypto';
import { isSourceDisabled, shouldAttempt, type SourceHealth } from '@funmary/core';
import type { FetchHolidaysResult } from '@funmary/sources';
import type { JobDefinition } from './runner.ts';
import { failSource, succeedSource, type SourceAlert, type SourceRun } from './source-run.ts';

/** SOURCES_DISABLED と source_status で使う、取得元の名前 */
export const HOLIDAYS_SOURCE = 'holidays';

/** 次に試すまでの間隔 (失敗のあとの待ちの基準) */
const INTERVAL_MS = 24 * 60 * 60 * 1000;
/** これより少なければ、壊れた内容とみなす (CSV には 1955 年からの祝日が、1 年に 15 件ほど載っている) */
const MIN_HOLIDAYS = 15;

export interface ImportHolidaysDeps {
	readonly fetchHolidays: () => Promise<FetchHolidaysResult>;
	/** SOURCES_DISABLED */
	readonly disabledSources: readonly string[];
	readonly health: {
		load(source: string): SourceHealth;
		save(source: string, health: SourceHealth): void;
	};
	readonly holidays: {
		replaceAll(
			source: 'cabinetOffice',
			items: readonly { readonly date: string; readonly name: string }[],
		): void;
	};
	readonly alert: (alert: SourceAlert) => Promise<unknown>;
}

export function createImportHolidaysJob(deps: ImportHolidaysDeps): JobDefinition {
	return {
		name: 'import-holidays',
		// 日本時間の月曜 4 時
		schedule: '0 4 * * 1',
		timeoutMs: 60 * 1000,
		jitterMs: 10 * 60 * 1000,
		async run({ now }) {
			const at = now();
			if (isSourceDisabled(deps.disabledSources, HOLIDAYS_SOURCE)) {
				return '祝日の取得は、SOURCES_DISABLED で無効にされています';
			}
			const health = deps.health.load(HOLIDAYS_SOURCE);
			if (!shouldAttempt(health, at)) {
				return `不調のあとの待ち時間なので、${health.nextAttemptAt?.toISOString() ?? ''} まで待っています`;
			}
			const run: SourceRun = {
				label: '祝日の CSV',
				source: HOLIDAYS_SOURCE,
				health,
				save: (next) => deps.health.save(HOLIDAYS_SOURCE, next),
				alert: deps.alert,
				at,
				intervalMs: INTERVAL_MS,
			};

			// ETag は保存する場所がないので使わず、読んだ内容のハッシュで変化を見る
			const result = await deps.fetchHolidays();
			if (result.kind === 'failed') return failSource(run, result.message);
			if (result.kind === 'not-modified') {
				await succeedSource(run);
				return '祝日は変わっていません';
			}
			if (result.holidays.length < MIN_HOLIDAYS) {
				return failSource(
					run,
					`祝日の件数が ${result.holidays.length} 件で少なすぎるので、入れ替えません`,
					{ title: '内閣府の祝日の CSV の形が変わりました' },
				);
			}

			const contentHash = createHash('sha256')
				.update(JSON.stringify(result.holidays))
				.digest('hex');
			if (contentHash === health.contentHash) {
				await succeedSource(run, { contentHash });
				return '祝日は変わっていません';
			}
			deps.holidays.replaceAll('cabinetOffice', result.holidays);
			await succeedSource(run, { contentHash });
			return (
				`祝日を ${result.holidays.length} 件取り込みました` +
				(result.skipped > 0 ? ` (読めなかった行 ${result.skipped} 件)` : '')
			);
		},
	};
}
