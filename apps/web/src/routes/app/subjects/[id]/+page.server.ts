// 授業の詳細 (設計書 12.2)。シラバスの内容は取り込み時に保存したものを出し、画面を開くたびに大学のサイトへは取りに行かない。
// シラバスにない授業として足した科目は、足した人と管理者が直したり消したりできる。
import { error, fail, redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import { describeClassChange } from '$lib/class-change-label.ts';
import { getServices } from '$lib/server/services.ts';
import { canEditSubject, findSameName, parseUserSubjectForm } from '$lib/server/user-subject.ts';

/** 休講などの種類を、時間割の画面と同じ表示 (StatusBadge) にそろえる */
const CHANGE_STATUS = {
	cancellation: 'cancelled',
	makeup: 'makeup',
	roomChange: 'roomChanged',
} as const;

/** 画面に出すリンクは https のものだけにする (javascript: などを href に入れないため) */
const httpsOnly = (url: string | null) => (url?.startsWith('https://') ? url : null);

/** URL の科目。なければ 404 */
function findSubject(params: Partial<Record<string, string>>) {
	const id = params['id'] ?? '';
	if (!/^[1-9]\d{0,9}$/.test(id)) error(404, '科目が見つかりません');
	const subject = getServices().subjects.findById(Number(id));
	if (!subject) error(404, '科目が見つかりません');
	return subject;
}

export const load: ServerLoad = ({ locals, params }) => {
	if (!locals.user) redirect(303, '/login');
	const { courses, classChanges } = getServices();
	const subject = findSubject(params);

	const registration = courses
		.listRegistrations(locals.user.id)
		.find((r) => r.subjectId === subject.id);

	return {
		subject: {
			academicYear: subject.academicYear,
			name: subject.name,
			teacher: subject.teacher,
			credits: subject.credits,
			term: subject.term,
			attributes: Object.entries(subject.attributes),
			syllabus: Object.entries(subject.syllabus),
			syllabusUrl: httpsOnly(subject.syllabusUrl),
			userAdded: subject.source === 'user',
		},
		canEdit: canEditSubject(subject, locals.user),
		slots: courses
			.slotsOf(subject.id)
			.map(({ weekday, period, room }) => ({ weekday, period, room })),
		registered: registration !== undefined,
		hopeCourseUrl: httpsOnly(registration?.hopeCourseUrl ?? null),
		changes: classChanges.listBySubject(subject.id).map((change, index) => ({
			// 照合の結果、同じ日と時限に別の授業名の行が重なりうるので、並びの番号も入れる
			key: `${change.kind}-${change.date}-${change.period}-${index}`,
			date: change.date,
			period: change.period,
			comment: change.comment,
			withdrawn: change.withdrawn,
			status: CHANGE_STATUS[change.kind],
			...describeClassChange(change),
		})),
	};
};

export const actions: Actions = {
	/** シラバスにない授業の名前、学期、教員を直す (足した人と管理者だけ) */
	updateSubject: async ({ request, locals, params }) => {
		if (!locals.user) redirect(303, '/login');
		const subject = findSubject(params);
		if (!canEditSubject(subject, locals.user)) {
			return fail(403, { error: 'この科目は直せません。' });
		}
		const parsed = parseUserSubjectForm(await request.formData());
		if (!parsed.ok) return fail(400, { error: parsed.error });
		const { subjects } = getServices();
		const same = findSameName(
			parsed.value.name,
			subjects.list(subject.academicYear).filter((other) => other.id !== subject.id),
		);
		if (same) return fail(409, { error: `同じ名前の科目「${same.name}」があります。` });
		subjects.updateUserSubject(subject.id, parsed.value, new Date());
		return { message: '授業を直しました。' };
	},
	/** シラバスにない授業を消す。履修登録と時間割の枠も消える */
	deleteSubject: async ({ request, locals, params }) => {
		if (!locals.user) redirect(303, '/login');
		const subject = findSubject(params);
		if (!canEditSubject(subject, locals.user)) {
			return fail(403, { error: 'この科目は消せません。' });
		}
		if ((await request.formData()).get('confirm') !== 'on') {
			return fail(400, { error: '消すと元に戻せないことを確かめて、チェックを入れてください。' });
		}
		getServices().subjects.deleteUserSubject(subject.id);
		redirect(303, '/app/courses');
	},
};
