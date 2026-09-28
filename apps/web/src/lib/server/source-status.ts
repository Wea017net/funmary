// 取得元の状態 (設計書 4.5)。管理画面 (/admin/status) と管理用コマンド sources status が使う。
import { isUnhealthy, jstDateTime, type SourceHealth } from '@funmary/core';
import { SOURCE_STATE_LABELS, type SourceState } from '../source-label.ts';

/** 取得元の表示名。ここにない取得元は、名前をそのまま出す */
const SOURCE_LABELS = new Map([
	['portal', '学生ポータル (休講など)'],
	['syllabus', '公開シラバス'],
	['holidays', '内閣府の祝日'],
	['academic-calendar', '学年暦 (大学サイトの PDF)'],
]);

export interface SourceStatusRow {
	readonly source: string;
	readonly label: string;
	/** 日本時間の "YYYY-MM-DD HH:MM" */
	readonly lastSuccessAt: string | null;
	readonly lastAttemptAt: string | null;
	readonly nextAttemptAt: string | null;
	readonly consecutiveFailures: number;
	readonly lastError: string | null;
	readonly state: SourceState;
}

const format = (date: Date | null) => {
	if (!date) return null;
	const { date: day, time } = jstDateTime(date);
	return `${day} ${time}`;
};

function stateOf(health: SourceHealth): SourceState {
	if (isUnhealthy(health)) return 'unhealthy';
	if (health.consecutiveFailures > 0) return 'failing';
	if (health.lastAttemptAt === null) return 'never';
	return 'ok';
}

/** 知っている取得元は、記録がなくても並べる。知らない取得元 (記録だけあるもの) は後ろに足す */
export function sourceStatuses(
	recorded: readonly { readonly source: string; readonly health: SourceHealth }[],
): SourceStatusRow[] {
	const bySource = new Map(recorded.map((item) => [item.source, item.health]));
	const names = [
		...SOURCE_LABELS.keys(),
		...[...bySource.keys()].filter((s) => !SOURCE_LABELS.has(s)),
	];
	return names.map((source) => {
		const health = bySource.get(source);
		return {
			source,
			label: SOURCE_LABELS.get(source) ?? source,
			lastSuccessAt: format(health?.lastSuccessAt ?? null),
			lastAttemptAt: format(health?.lastAttemptAt ?? null),
			nextAttemptAt: format(health?.nextAttemptAt ?? null),
			consecutiveFailures: health?.consecutiveFailures ?? 0,
			lastError: health?.lastError ?? null,
			state: health ? stateOf(health) : 'never',
		};
	});
}

/** 管理用コマンド sources status の表示。取得元ごとに 1 行 */
export function formatSourcesReport(rows: readonly SourceStatusRow[]): string[] {
	return rows.map((row) => {
		const head = `${row.label} [${row.source}]: ${SOURCE_STATE_LABELS[row.state]}`;
		if (row.state === 'never') return head;
		const parts = [
			`最終成功 ${row.lastSuccessAt ?? 'なし'}`,
			`最終試行 ${row.lastAttemptAt ?? 'なし'}`,
			`連続の失敗 ${row.consecutiveFailures} 回`,
			...(row.nextAttemptAt ? [`次の試行 ${row.nextAttemptAt}`] : []),
		];
		return `${head}。${parts.join('、')}${row.lastError ? `。直近の失敗: ${row.lastError}` : ''}`;
	});
}
