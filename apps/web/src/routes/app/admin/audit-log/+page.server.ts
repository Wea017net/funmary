// 利用者が全体に影響する操作をしたときの記録 (設計書、監査ログ)。見るだけの画面で、ここから何も変えない。
import type { ServerLoad } from '@sveltejs/kit';
import { jstDateTime } from '@funmary/core';
import { requireModerator } from '$lib/server/admin.ts';
import { getServices } from '$lib/server/services.ts';
import { subjectPathParams, type SubjectPathParams } from '$lib/subject-path.ts';

/** 出す件数 */
const ENTRIES = 200;

const ACTION_LABELS: Record<string, string> = {
	'subject.create': '科目を足した',
	'subject.update': '科目の情報を直した',
	'subject.delete': '科目を消した',
	'lesson.resolve': '授業名を紐付けた',
	'lesson.unresolve': '授業名の紐付けを外した',
	'lesson.ignore': '授業名を科目にしないことにした',
	'lesson.restore': '授業名を一覧に戻した',
	'slot.approve': '曜日と時限の提出を承認した',
};

// この画面は、モデレーターと管理者の両方が見られる (監査や確認は、モデレーターにも任せるため)
export const load: ServerLoad = ({ locals }) => {
	requireModerator(locals);
	return {
		entries: getServices()
			.auditLog.recent(ENTRIES)
			.map((entry) => {
				const { date, time } = jstDateTime(entry.createdAt);
				return {
					id: entry.id,
					actorEmail: entry.actorEmail,
					action: ACTION_LABELS[entry.action] ?? entry.action,
					summary: entry.summary,
					subjectPath: entry.subject
						? (subjectPathParams(entry.subject) satisfies SubjectPathParams)
						: null,
					at: `${date} ${time}`,
				};
			}),
	};
};
