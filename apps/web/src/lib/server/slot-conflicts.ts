import type { SlotConflict } from '@funmary/db';
import type { Services } from './services.ts';

/**
 * 共有の枠の教室が、登録済みのものと食い違ったことを管理者に知らせる。
 * 利用者どうしの登録の誤りか、教室変更の可能性があるので、管理者が確かめる。
 */
export async function alertSlotConflicts(
	services: Pick<Services, 'alertAdmin'>,
	conflicts: readonly SlotConflict[],
): Promise<void> {
	if (conflicts.length === 0) return;
	await services.alertAdmin({
		severity: 'warn',
		title: '時間割の枠の教室が、利用者どうしで食い違っています',
		message: conflicts
			.map(
				(c) =>
					`科目 ${c.subjectId} の ${c.weekday} 曜 ${c.period} 限: 登録済み ${c.existingRoom ?? '(空)'}、取り込み ${c.importedRoom ?? '(空)'}`,
			)
			.join('\n'),
		key: `slot-conflict:${conflicts.map((c) => `${c.subjectId}-${c.weekday}-${c.period}`).join(',')}`,
	});
}

/**
 * 「モデレーターが確認してから登録する」設定のときに、確認待ちの提出があることをモデレーターに知らせる。
 * subjects チャンネルに送り、warn にして subjects ロールにもメンションする
 */
export async function alertSlotSubmission(
	services: Pick<Services, 'alertAdmin'>,
	subjectName: string,
): Promise<void> {
	await services.alertAdmin({
		severity: 'warn',
		category: 'subjects',
		title: '曜日と時限の確認待ちがあります',
		message: `${subjectName} の曜日と時限が提出されました。管理画面の「曜日と時限の確認」から確かめてください。`,
	});
}
