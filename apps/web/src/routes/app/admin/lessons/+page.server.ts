// 照合できなかった授業名を、管理者が科目に紐付ける (設計書 9.1 の 7、12.1)。
// 紐付けたら、その名前の休講などにもすぐ科目を入れる。次の取得からは、定期処理が紐付けを先に使う。
import { fail, type Actions, type ServerLoad } from '@sveltejs/kit';
import { jstDateTime, rankCandidates } from '@funmary/core';
import { requireAdmin } from '$lib/server/admin.ts';
import { getServices } from '$lib/server/services.ts';
import { findSameName, parseUserSubjectForm } from '$lib/server/user-subject.ts';
import { formatTerm } from '$lib/term-label.ts';

/** 名前ごとに出す候補の数 */
const CANDIDATES = 5;

export const load: ServerLoad = ({ locals }) => {
	requireAdmin(locals);
	const { subjects, unmatchedLessons } = getServices();
	const academicYear = subjects.latestYear();
	// シラバスにない授業を作るときの学期の既定。4 月から 8 月は前期、それ以外は後期
	const month = Number(jstDateTime(new Date()).date.slice(5, 7));
	const defaultTerm = month >= 4 && month <= 8 ? 'spring' : 'fall';
	if (academicYear === null) return { academicYear: null, lessons: [], defaultTerm };
	const all = subjects.list(academicYear);
	return {
		academicYear,
		defaultTerm,
		lessons: unmatchedLessons.listUnresolved(academicYear).map((lesson) => ({
			lessonName: lesson.lessonName,
			firstSeenAt: lesson.firstSeenAt.toISOString(),
			lastSeenAt: lesson.lastSeenAt.toISOString(),
			candidates: rankCandidates(lesson.lessonName, all, CANDIDATES).map((subject) => ({
				id: subject.id,
				label: `${subject.name} (${subject.syllabusId}、${formatTerm(subject.term)})`,
			})),
		})),
	};
};

export const actions: Actions = {
	/** シラバスにない授業として科目を作り、その授業名を紐付ける */
	createSubject: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const form = await request.formData();
		const lessonName = form.get('lessonName');
		if (typeof lessonName !== 'string' || lessonName === '') {
			return fail(400, { error: '授業名がありません。' });
		}
		const parsed = parseUserSubjectForm(form);
		if (!parsed.ok) return fail(400, { error: parsed.error });
		const { subjects, unmatchedLessons, classChanges } = getServices();
		const academicYear = subjects.latestYear();
		if (academicYear === null) return fail(400, { error: '科目がまだ取り込まれていません。' });
		const same = findSameName(parsed.value.name, subjects.list(academicYear));
		if (same) {
			return fail(409, {
				error: `同じ名前の科目「${same.name}」があります。候補から選んで紐付けてください。`,
			});
		}
		const id = subjects.createUserSubject({ academicYear, ...parsed.value }, admin.id, new Date());
		if (!unmatchedLessons.resolve(academicYear, lessonName, id)) {
			subjects.deleteUserSubject(id);
			return fail(400, { error: 'この授業名は記録されていません。' });
		}
		const assigned = classChanges.assignSubject(lessonName, id);
		return {
			message:
				`${parsed.value.name} を科目として作り、${lessonName} を紐付けました (休講などの ${assigned} 件に科目を入れました)。` +
				'授業時間割の PDF を取り込み直すと、この授業の曜日と時限も入ります。',
		};
	},
	resolve: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const lessonName = form.get('lessonName');
		const subjectIdText = form.get('subjectId');
		const syllabusIdText = form.get('syllabusId');
		if (typeof lessonName !== 'string' || lessonName === '') {
			return fail(400, { error: '授業名がありません。' });
		}
		const { subjects, unmatchedLessons, classChanges } = getServices();
		const academicYear = subjects.latestYear();
		if (academicYear === null) return fail(400, { error: '科目がまだ取り込まれていません。' });

		// シラバスの番号が書かれていれば、候補の選択より優先する
		const syllabusId = typeof syllabusIdText === 'string' ? syllabusIdText.trim() : '';
		let subject = null;
		if (syllabusId !== '') {
			if (!/^\d{1,10}$/.test(syllabusId)) {
				return fail(400, { error: 'シラバスの番号は数字で入れてください。' });
			}
			subject = subjects.findBySyllabus(academicYear, syllabusId);
		} else if (typeof subjectIdText === 'string' && /^[1-9]\d{0,9}$/.test(subjectIdText)) {
			subject = subjects.findById(Number(subjectIdText));
		}
		if (subject?.academicYear !== academicYear) {
			return fail(400, { error: `${academicYear} 年度の科目が見つかりませんでした。` });
		}

		if (!unmatchedLessons.resolve(academicYear, lessonName, subject.id)) {
			return fail(400, { error: 'この授業名は記録されていません。' });
		}
		const assigned = classChanges.assignSubject(lessonName, subject.id);
		return {
			message: `${lessonName} を ${subject.name} に紐付けました (休講などの ${assigned} 件に科目を入れました)。`,
		};
	},
};
