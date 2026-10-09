// 「モデレーターが確認してから登録する」設定のときの、曜日と時限の確認 (監査ログの節)。
// 確認待ちの一覧はモデレーターと管理者が見られるが、設定そのもの (だれでも/確認して/だれも) は管理者だけが変えられる。
import { fail, type Actions, type ServerLoad } from '@sveltejs/kit';
import { jstDateTime } from '@funmary/core';
import { requireAdmin, requireModerator } from '#lib/server/admin.ts';
import { getServices } from '#lib/server/services.ts';
import {
	readSlotSharingMode,
	saveSlotSharingMode,
	SLOT_SHARING_MODE_LABELS,
	SLOT_SHARING_MODES,
	type SlotSharingMode,
} from '#lib/server/slot-permission.ts';
import { subjectPathParams } from '#lib/subject-path.ts';

export const load: ServerLoad = ({ locals }) => {
	const user = requireModerator(locals);
	const { settings, slotSubmissions, subjects } = getServices();
	return {
		mode: readSlotSharingMode(settings),
		// 設定そのものを変えられるのは管理者だけ。モデレーターには確認待ちの一覧だけを出す
		canChangeMode: user.role === 'admin',
		modes: SLOT_SHARING_MODES.map((mode) => ({ id: mode, label: SLOT_SHARING_MODE_LABELS[mode] })),
		pending: slotSubmissions.listPending().map((submission) => {
			const { date, time } = jstDateTime(submission.submittedAt);
			const subject = subjects.findById(submission.subjectId);
			return {
				id: submission.id,
				subjectName: submission.subjectName,
				subjectPath: subject ? subjectPathParams(subject) : null,
				weekday: submission.weekday,
				period: submission.period,
				room: submission.room,
				submittedByEmail: submission.submittedByEmail,
				submittedAt: `${date} ${time}`,
			};
		}),
	};
};

export const actions: Actions = {
	/** だれが共有の枠を登録できるかを変える (管理者だけ) */
	saveMode: async ({ request, locals }) => {
		requireAdmin(locals);
		const mode = (await request.formData()).get('mode');
		if (typeof mode !== 'string' || !(SLOT_SHARING_MODES as readonly string[]).includes(mode)) {
			return fail(400, { error: '知らない設定値です。' });
		}
		saveSlotSharingMode(getServices().settings, mode as SlotSharingMode, new Date());
		return { message: '設定を保存しました。' };
	},

	/** 提出を承認し、共有の枠に入れる */
	approve: async ({ request, locals }) => {
		const moderator = requireModerator(locals);
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id)) return fail(400, { error: '提出が見つかりません。' });
		const services = getServices();
		const submission = services.slotSubmissions.find(id);
		if (!submission) return fail(400, { error: '提出が見つかりません。' });
		const now = new Date();
		if (!services.slotSubmissions.decide(id, 'approved', moderator.id, now)) {
			return fail(400, { error: 'すでに決めた提出です。' });
		}
		services.courses.addSharedSlots(
			[submission],
			{ source: 'manual', createdBy: moderator.id },
			now,
		);
		const subject = services.subjects.findById(submission.subjectId);
		services.auditLog.record(
			{
				actorId: moderator.id,
				action: 'slot.approve',
				subjectId: submission.subjectId,
				summary: `${subject?.name ?? '科目'} の曜日と時限の提出を承認した`,
			},
			now,
		);
		return { message: '承認し、共有の枠に登録しました。' };
	},

	/** 提出を却下する */
	reject: async ({ request, locals }) => {
		const moderator = requireModerator(locals);
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id)) return fail(400, { error: '提出が見つかりません。' });
		if (!getServices().slotSubmissions.decide(id, 'rejected', moderator.id, new Date())) {
			return fail(400, { error: '提出が見つからないか、すでに決めています。' });
		}
		return { message: '却下しました。' };
	},
};
