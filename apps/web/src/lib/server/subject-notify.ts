// シラバスにない授業 (利用者が足した科目) の公開と、公開範囲の変更、削除を、Discord の subjects チャンネルに知らせる (Issue #164)。
import type { SubjectVisibility } from '@funmary/db';
import type { SubjectPathParams } from '$lib/subject-path.ts';
import type { Services } from './services.ts';

const VISIBILITY_LABELS: Record<SubjectVisibility, string> = {
	public: '全体公開',
	link: '限定公開 (URL を知っていれば見られる)',
	private: '非公開 (足した人と管理者だけ)',
};

const subjectUrl = (origin: string, path: SubjectPathParams) =>
	`${origin}/app/subjects/${path.year}/${path.code}`;

/** シラバスにない授業が (既定で) 全体公開されたことを知らせる */
export async function alertSubjectPublished(
	services: Pick<Services, 'alertAdmin' | 'origin'>,
	subjectName: string,
	path: SubjectPathParams,
): Promise<void> {
	await services.alertAdmin({
		severity: 'info',
		category: 'subjects',
		title: '科目が全体に公開されました',
		message: `${subjectName}\n${subjectUrl(services.origin, path)}`,
	});
}

/** 公開範囲が変わったことを知らせる */
export async function alertSubjectVisibilityChanged(
	services: Pick<Services, 'alertAdmin' | 'origin'>,
	subjectName: string,
	path: SubjectPathParams,
	visibility: SubjectVisibility,
): Promise<void> {
	await services.alertAdmin({
		severity: 'info',
		category: 'subjects',
		title: `科目の公開範囲が変わりました (${VISIBILITY_LABELS[visibility]})`,
		message: `${subjectName}\n${subjectUrl(services.origin, path)}`,
	});
}

/** シラバスにない授業が消されたことを知らせる */
export async function alertSubjectDeleted(
	services: Pick<Services, 'alertAdmin'>,
	subjectName: string,
): Promise<void> {
	await services.alertAdmin({
		severity: 'info',
		category: 'subjects',
		title: '科目が消されました',
		message: subjectName,
	});
}
