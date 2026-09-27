// 授業の詳細 (設計書 12.2)。シラバスの内容は取り込み時に保存したものを出し、画面を開くたびに大学のサイトへは取りに行かない。
import { error, redirect, type ServerLoad } from '@sveltejs/kit';
import { describeClassChange } from '$lib/class-change-label.ts';
import { getServices } from '$lib/server/services.ts';

/** 画面に出すリンクは https のものだけにする (javascript: などを href に入れないため) */
const httpsOnly = (url: string | null) => (url?.startsWith('https://') ? url : null);

export const load: ServerLoad = ({ locals, params }) => {
	if (!locals.user) redirect(303, '/login');
	const id = params['id'] ?? '';
	if (!/^[1-9]\d{0,9}$/.test(id)) error(404, '科目が見つかりません');
	const { courses, subjects, classChanges } = getServices();
	const subject = subjects.findById(Number(id));
	if (!subject) error(404, '科目が見つかりません');

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
		},
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
			...describeClassChange(change),
		})),
	};
};
