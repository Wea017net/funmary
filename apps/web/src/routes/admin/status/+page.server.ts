// 取得元の状態と、定期処理の実行履歴 (設計書 4.5、12.1)。見るだけで、ここから大学のサービスには接続しない。
import type { ServerLoad } from '@sveltejs/kit';
import { jstDateTime } from '@funmary/core';
import { requireAdmin } from '$lib/server/admin.ts';
import { getServices } from '$lib/server/services.ts';
import { sourceStatuses } from '$lib/server/source-status.ts';

/** 実行履歴を出す件数 */
const RUNS = 50;

/** 定期処理の表示名。ここにないものは、名前をそのまま出す */
const JOB_LABELS = new Map([
	['scrape-portal', '休講などの取得'],
	['import-syllabus', '公開シラバスの取り込み'],
	['import-holidays', '祝日の取り込み'],
	['remind-timetable-import', '時間割の PDF の取り込みの案内'],
]);

const formatTime = (date: Date) => {
	const { date: day, time } = jstDateTime(date);
	return `${day} ${time}`;
};

export const load: ServerLoad = ({ locals }) => {
	requireAdmin(locals);
	const { sourceHealth, jobRuns } = getServices();
	return {
		sources: sourceStatuses(sourceHealth.list()),
		runs: jobRuns.recentAll(RUNS).map((run) => ({
			id: run.id,
			job: JOB_LABELS.get(run.job) ?? run.job,
			startedAt: formatTime(run.startedAt),
			// 秒の単位で出す。終わっていなければ null
			seconds:
				run.finishedAt === null
					? null
					: Math.max(0, Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000)),
			status: run.status,
			message: run.message,
		})),
	};
};
