// 履修科目の登録 (設計書 12.1)。科目を探して登録し、曜日と時限が分からない科目には、利用者が手で枠を足す。
// 枠は科目ごとに共有するので、既にある枠は上書きしない。教室が食い違えば、管理者に知らせる。
import { fail, redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import { jstDateTime } from '@funmary/core';
import { parseSlotForm, parseSubjectId } from '$lib/server/course-form.ts';
import { getServices } from '$lib/server/services.ts';
import { alertSlotConflicts } from '$lib/server/slot-conflicts.ts';
import { findSameName, parseUserSubjectForm } from '$lib/server/user-subject.ts';
import { searchSubjects } from '$lib/subject-search.ts';

export const load: ServerLoad = ({ locals, url }) => {
	if (!locals.user) redirect(303, '/login');
	const { courses, subjects } = getServices();
	// 新年度のシラバスがまだなければ、前年度の科目を使い続ける
	const academicYear = subjects.latestYear();
	// シラバスにない授業を足すときの学期の既定。4 月から 8 月は前期、それ以外は後期
	const month = Number(jstDateTime(new Date()).date.slice(5, 7));
	const defaultTerm = month >= 4 && month <= 8 ? 'spring' : 'fall';
	if (academicYear === null) {
		return { academicYear: null, registered: [], query: '', results: [], defaultTerm };
	}

	const registered = courses
		.listRegistrations(locals.user.id)
		.flatMap(({ subjectId }) => {
			const subject = subjects.findById(subjectId);
			if (subject?.academicYear !== academicYear) return [];
			return [
				{
					id: subject.id,
					name: subject.name,
					teacher: subject.teacher,
					term: subject.term,
					userAdded: subject.source === 'user',
					slots: courses
						.slotsOf(subject.id)
						.map(({ weekday, period, room }) => ({ weekday, period, room })),
				},
			];
		})
		.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

	const query = (url.searchParams.get('q') ?? '').slice(0, 100);
	const registeredIds = new Set(registered.map((subject) => subject.id));
	const results = searchSubjects(
		subjects.list(academicYear).filter((subject) => !registeredIds.has(subject.id)),
		query,
	).map(({ id, name, teacher, term, source }) => ({
		id,
		name,
		teacher,
		term,
		userAdded: source === 'user',
	}));

	return { academicYear, registered, query, results, defaultTerm };
};

export const actions: Actions = {
	register: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		const subjectId = parseSubjectId(await request.formData());
		const { courses, subjects } = getServices();
		const subject = subjectId === null ? null : subjects.findById(subjectId);
		if (!subject) return fail(400, { error: '科目が見つかりませんでした。探し直してください。' });
		courses.register(locals.user.id, subject.id, new Date());
		return { message: `${subject.name} を履修科目に登録しました。` };
	},

	/** シラバスにない授業を科目として足し、足した人の履修科目に登録する */
	createSubject: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		const parsed = parseUserSubjectForm(await request.formData());
		if (!parsed.ok) return fail(400, { error: parsed.error });
		const { courses, subjects } = getServices();
		const academicYear = subjects.latestYear();
		if (academicYear === null) {
			return fail(400, { error: '科目がまだ取り込まれていないので、足せません。' });
		}
		const same = findSameName(parsed.value.name, subjects.list(academicYear));
		if (same) {
			return fail(409, {
				error: `同じ名前の科目「${same.name}」があります。「科目を探す」から登録してください。`,
			});
		}
		const now = new Date();
		const id = subjects.createUserSubject({ academicYear, ...parsed.value }, locals.user.id, now);
		courses.register(locals.user.id, id, now);
		return {
			message: `${parsed.value.name} を足して、履修科目に登録しました。曜日と時限を登録してください。`,
		};
	},

	unregister: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		const subjectId = parseSubjectId(await request.formData());
		const { courses, subjects } = getServices();
		if (subjectId === null || !courses.unregister(locals.user.id, subjectId)) {
			return fail(400, { error: 'この科目は履修科目に登録されていません。' });
		}
		const name = subjects.findById(subjectId)?.name ?? '科目';
		return { message: `${name} の登録を取り消しました。` };
	},

	addSlot: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		const parsed = parseSlotForm(await request.formData());
		if (!parsed.ok) return fail(400, { error: parsed.error });
		const services = getServices();
		// 履修していない科目の枠は足させない (ほかの利用者の時間割にも使われるため)
		if (!services.courses.isRegistered(locals.user.id, parsed.value.subjectId)) {
			return fail(403, { error: '履修科目に登録した科目だけ、曜日と時限を登録できます。' });
		}
		const result = services.courses.addSharedSlots(
			[parsed.value],
			{ source: 'manual', createdBy: locals.user.id },
			new Date(),
		);
		if (result.conflicts.length > 0) {
			await alertSlotConflicts(services, result.conflicts);
			return fail(409, {
				error: 'この曜日と時限は、別の教室で登録されています。上書きはせず、管理者が確かめます。',
			});
		}
		if (result.added === 0 && result.updated === 0) {
			return { message: 'この曜日と時限は、既に登録されています。' };
		}
		return { message: '曜日と時限を登録しました。' };
	},
};
