// 照合できなかった授業名を、管理者が科目に紐付ける (設計書 9.1 の 7、12.1)。
// 紐付けたら、その名前の休講などにもすぐ科目を入れる。次の取得からは、定期処理が紐付けを先に使う。
import { fail, type Actions, type ServerLoad } from '@sveltejs/kit';
import { rankCandidates } from '@funmary/core';
import { requireAdmin } from '$lib/server/admin.ts';
import { getServices } from '$lib/server/services.ts';
import { formatTerm } from '$lib/term-label.ts';

/** 名前ごとに出す候補の数 */
const CANDIDATES = 5;

export const load: ServerLoad = ({ locals }) => {
	requireAdmin(locals);
	const { subjects, unmatchedLessons } = getServices();
	const academicYear = subjects.latestYear();
	if (academicYear === null) return { academicYear: null, lessons: [] };
	const all = subjects.list(academicYear);
	return {
		academicYear,
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
