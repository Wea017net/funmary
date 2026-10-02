// 取得元の状態、定期処理の実行履歴、応答時間 (設計書 4.5、12.1)。
// 定期処理は、ここから今すぐ動かせる (サーバーの中で動かすので、同じ処理が同時に 2 つ動くことはない)
import { fail, type Actions, type ServerLoad } from '@sveltejs/kit';
import { jstDateTime } from '@funmary/core';
import { requireAdmin } from '$lib/server/admin.ts';
import { JOB_LABELS } from '$lib/server/jobs.ts';
import { getServices } from '$lib/server/services.ts';
import { sourceStatuses } from '$lib/server/source-status.ts';

/** 実行履歴を出す件数 */
const RUNS = 50;

const label = (job: string) => JOB_LABELS.get(job) ?? job;

const formatTime = (date: Date) => {
	const { date: day, time } = jstDateTime(date);
	return `${day} ${time}`;
};

export const load: ServerLoad = ({ locals }) => {
	requireAdmin(locals);
	const { sourceHealth, jobRuns, jobs, responseTimes } = getServices();
	return {
		sources: sourceStatuses(sourceHealth.list()),
		jobs: jobs.names.map((name) => ({ name, label: label(name) })),
		runs: jobRuns.recentAll(RUNS).map((run) => ({
			id: run.id,
			job: label(run.job),
			startedAt: formatTime(run.startedAt),
			// 秒の単位で出す。終わっていなければ null
			seconds:
				run.finishedAt === null
					? null
					: Math.max(0, Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000)),
			status: run.status,
			message: run.message,
		})),
		responseTimes: responseTimes.summary(new Date()),
	};
};

export const actions: Actions = {
	runJob: async ({ request, locals }) => {
		requireAdmin(locals);
		const name = (await request.formData()).get('job');
		const { jobs } = getServices();
		if (typeof name !== 'string' || !jobs.names.includes(name)) {
			return fail(404, { error: '定期処理が見つかりません。' });
		}
		// 終わるまで待つ。取得の処理は、ふつう数秒から数十秒で終わる
		const result = await jobs.runNow(name);
		const detail = result.message ? `: ${result.message}` : '';
		if (result.status === 'failed') {
			return fail(500, { error: `${label(name)} が失敗しました${detail}` });
		}
		if (result.status === 'skipped') {
			return { message: `${label(name)} は動かしませんでした${detail}` };
		}
		return { message: `${label(name)} を動かしました${detail}` };
	},
};
