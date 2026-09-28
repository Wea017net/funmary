// 大学サイトの学年暦の PDF を取り込む定期処理 (設計書 10 章)。月に 1 回取りに行き、内容が変わったときだけ読み取って取り込む。
// 読み取れないときや警告があるときは書き込まず、管理者に知らせて、管理画面からの取り込みを案内する。
import { createHash } from 'node:crypto';
import { isSourceDisabled, shouldAttempt, type SourceHealth } from '@funmary/core';
import type { FetchAcademicCalendarResult } from '@funmary/sources';
import type { JobDefinition } from './runner.ts';
import { failSource, succeedSource, type SourceAlert, type SourceRun } from './source-run.ts';

/** SOURCES_DISABLED と source_status で使う、取得元の名前 */
export const ACADEMIC_CALENDAR_SOURCE = 'academic-calendar';

/** 次に試すまでの間隔 (失敗のあとの待ちの基準) */
const INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 手で取り込むときの案内。管理者への知らせに付ける */
const MANUAL_HINT =
	'設定の管理の「学年暦」の画面で、大学サイトの学年暦の PDF を上げて取り込んでください (管理用コマンドの calendar import でもよい)。';

/** PDF を読み取って取り込んだ結果。読み取りと書き込みは、呼ぶ側 (apps/web) が行う */
export type AcademicCalendarImportOutcome =
	| { readonly kind: 'invalid'; readonly reason: string }
	| { readonly kind: 'has-warnings'; readonly warnings: readonly string[] }
	| {
			readonly kind: 'applied';
			readonly academicYear: number;
			/** 管理者が手で入れた値があるので、上書きしなかった数 */
			readonly skipped: number;
	  };

export interface ImportAcademicCalendarDeps {
	readonly fetchPdf: () => Promise<FetchAcademicCalendarResult>;
	readonly importPdf: (bytes: Uint8Array) => Promise<AcademicCalendarImportOutcome>;
	/** 取れた PDF の年度と URL を、画面から大学の公式の PDF を開けるように記録する */
	readonly recordOfficialPdf?: (info: { year: number; url: string }) => void;
	/** SOURCES_DISABLED */
	readonly disabledSources: readonly string[];
	readonly health: {
		load(source: string): SourceHealth;
		save(source: string, health: SourceHealth): void;
	};
	readonly alert: (alert: SourceAlert) => Promise<unknown>;
}

export function createImportAcademicCalendarJob(deps: ImportAcademicCalendarDeps): JobDefinition {
	return {
		name: 'import-academic-calendar',
		// 毎月 1 日の日本時間 5 時
		schedule: '0 5 1 * *',
		timeoutMs: 2 * 60 * 1000,
		jitterMs: 10 * 60 * 1000,
		async run({ now }) {
			const at = now();
			if (isSourceDisabled(deps.disabledSources, ACADEMIC_CALENDAR_SOURCE)) {
				return '学年暦の取得は、SOURCES_DISABLED で無効にされています';
			}
			const health = deps.health.load(ACADEMIC_CALENDAR_SOURCE);
			if (!shouldAttempt(health, at)) {
				return `不調のあとの待ち時間なので、${health.nextAttemptAt?.toISOString() ?? ''} まで待っています`;
			}
			const run: SourceRun = {
				label: '学年暦の PDF',
				source: ACADEMIC_CALENDAR_SOURCE,
				health,
				save: (next) => deps.health.save(ACADEMIC_CALENDAR_SOURCE, next),
				alert: deps.alert,
				at,
				intervalMs: INTERVAL_MS,
			};

			const fetched = await deps.fetchPdf();
			if (fetched.kind === 'failed') return failSource(run, `${fetched.message}。${MANUAL_HINT}`);

			deps.recordOfficialPdf?.({ year: fetched.year, url: fetched.url });
			const contentHash = createHash('sha256').update(fetched.bytes).digest('hex');
			if (contentHash === health.contentHash) {
				await succeedSource(run, { contentHash });
				return `${fetched.year} 年度の学年暦は変わっていません`;
			}

			const outcome = await deps.importPdf(fetched.bytes);
			if (outcome.kind === 'invalid') {
				// 大学サイトの PDF の作りが変わったとき。不調になるのを待たずに、すぐ知らせる
				return failSource(
					run,
					`${fetched.year} 年度の学年暦の PDF を読み取れませんでした: ${outcome.reason}。${MANUAL_HINT}`,
					{ title: '学年暦の PDF の作りが変わりました' },
				);
			}
			// 同じ内容で何度も知らせないよう、警告があっても、取得には成功したものとして内容の hash を残す
			await succeedSource(run, { contentHash });
			if (outcome.kind === 'has-warnings') {
				await deps.alert({
					severity: 'warn',
					title: `${fetched.year} 年度の学年暦の読み取りに警告があるので、取り込みませんでした`,
					message: [...outcome.warnings, MANUAL_HINT].join('\n'),
					key: `${ACADEMIC_CALENDAR_SOURCE}:warnings`,
				});
				return `${fetched.year} 年度の学年暦の読み取りに警告があるので、取り込みませんでした`;
			}
			const summary =
				`${outcome.academicYear} 年度の学年暦を取り込みました` +
				(outcome.skipped > 0
					? ` (手で入れた値がある ${outcome.skipped} 件は上書きしていません)`
					: '');
			await deps.alert({
				severity: 'info',
				title: summary,
				message: `取り込んだ内容は、設定の管理の「学年暦」の画面で確かめられます。取得元: ${fetched.url}`,
				key: `${ACADEMIC_CALENDAR_SOURCE}:imported`,
			});
			return summary;
		},
	};
}
