// 照合できなかった授業名を、管理者が扱いを決める。
// 既存の科目に紐付ける、シラバスにない授業として科目を作って紐付ける、科目にしない、の三つから選ぶ。紐付けは外して直せる。
// 紐付けたら、その名前の休講などにもすぐ科目を入れる。次の取得からは、定期処理が紐付けを先に使う。
import { fail, type Actions, type ServerLoad } from '@sveltejs/kit';
import { jstDateTime, rankCandidates } from '@funmary/core';
import { requireAdmin } from '#lib/server/admin.ts';
import { getServices } from '#lib/server/services.ts';
import { findSameName, parseUserSubjectForm } from '#lib/server/user-subject.ts';
import { subjectPathParams } from '#lib/subject-path.ts';
import { formatTerm } from '#lib/term-label.ts';

/** 名前ごとに出す候補の数 */
const CANDIDATES = 5;

const NO_NAME = '授業名がありません。';
const NOT_RECORDED = 'この授業名は記録されていません。';
const NOT_IMPORTED = '科目がまだ取り込まれていません。';

export const load: ServerLoad = ({ locals }) => {
	requireAdmin(locals);
	const { subjects, unmatchedLessons } = getServices();
	const academicYear = subjects.latestYear();
	// シラバスにない授業を作るときの学期の既定。4 月から 8 月は前期、それ以外は後期
	const month = Number(jstDateTime(new Date()).date.slice(5, 7));
	const defaultTerm = month >= 4 && month <= 8 ? 'spring' : 'fall';
	if (academicYear === null) {
		return { academicYear: null, defaultTerm, lessons: [], resolved: [], ignored: [] };
	}
	const all = subjects.list(academicYear);
	const candidatesOf = (lessonName: string) =>
		rankCandidates(lessonName, all, CANDIDATES).map((subject) => ({
			id: subject.id,
			label: `${subject.name} (${subject.syllabusId}、${formatTerm(subject.term)})`,
		}));
	const seen = (lesson: { firstSeenAt: Date; lastSeenAt: Date }) => ({
		firstSeenAt: lesson.firstSeenAt.toISOString(),
		lastSeenAt: lesson.lastSeenAt.toISOString(),
	});
	return {
		academicYear,
		defaultTerm,
		lessons: unmatchedLessons.listUnresolved(academicYear).map((lesson) => ({
			lessonName: lesson.lessonName,
			...seen(lesson),
			candidates: candidatesOf(lesson.lessonName),
		})),
		resolved: unmatchedLessons.listResolved(academicYear).flatMap((lesson) => {
			const subject = subjects.findById(lesson.subjectId);
			if (!subject) return [];
			return [
				{
					lessonName: lesson.lessonName,
					...seen(lesson),
					candidates: candidatesOf(lesson.lessonName),
					subject: {
						name: subject.name,
						path: subjectPathParams(subject),
						independent: subject.source === 'user',
					},
				},
			];
		}),
		ignored: unmatchedLessons.listIgnored(academicYear).map((lesson) => ({
			lessonName: lesson.lessonName,
			...seen(lesson),
		})),
	};
};

/** フォームの授業名を取り出す。空なら null */
async function readLessonName(request: Request): Promise<string | null> {
	const lessonName = (await request.formData()).get('lessonName');
	return typeof lessonName === 'string' && lessonName !== '' ? lessonName : null;
}

export const actions: Actions = {
	/** シラバスにない授業として科目を作り、その授業名を紐付ける */
	createSubject: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const form = await request.formData();
		const lessonName = form.get('lessonName');
		if (typeof lessonName !== 'string' || lessonName === '') {
			return fail(400, { error: NO_NAME });
		}
		const parsed = parseUserSubjectForm(form);
		if (!parsed.ok) return fail(400, { error: parsed.error });
		const { subjects, unmatchedLessons, classChanges } = getServices();
		const academicYear = subjects.latestYear();
		if (academicYear === null) return fail(400, { error: NOT_IMPORTED });
		const same = findSameName(parsed.value.name, subjects.list(academicYear));
		if (same) {
			return fail(409, {
				error: `同じ名前の科目「${same.name}」があります。候補から選んで紐付けてください。`,
			});
		}
		const now = new Date();
		const id = subjects.createUserSubject({ academicYear, ...parsed.value }, admin.id, now);
		if (!unmatchedLessons.resolve(academicYear, lessonName, id)) {
			subjects.deleteUserSubject(id);
			return fail(400, { error: NOT_RECORDED });
		}
		classChanges.unassignSubject(lessonName);
		const assigned = classChanges.assignSubject(lessonName, id);
		getServices().auditLog.record(
			{
				actorId: admin.id,
				action: 'subject.create',
				subjectId: id,
				summary: `${parsed.value.name} を科目として作り、${lessonName} を紐付けた`,
			},
			now,
		);
		return {
			message:
				`${parsed.value.name} を科目として作り、${lessonName} を紐付けました (休講などの ${assigned} 件に科目を入れました)。` +
				'授業時間割の PDF を取り込み直すと、この授業の曜日と時限も入ります。',
		};
	},
	/** 既存の科目に紐付ける。紐付け済みの名前なら、付け替える */
	resolve: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const form = await request.formData();
		const lessonName = form.get('lessonName');
		const subjectIdText = form.get('subjectId');
		const syllabusIdText = form.get('syllabusId');
		if (typeof lessonName !== 'string' || lessonName === '') {
			return fail(400, { error: NO_NAME });
		}
		const { subjects, unmatchedLessons, classChanges } = getServices();
		const academicYear = subjects.latestYear();
		if (academicYear === null) return fail(400, { error: NOT_IMPORTED });

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
			return fail(400, { error: NOT_RECORDED });
		}
		// 付け替えのときは、前の科目に入れた休講などを外してから入れ直す
		classChanges.unassignSubject(lessonName);
		const assigned = classChanges.assignSubject(lessonName, subject.id);
		getServices().auditLog.record(
			{
				actorId: admin.id,
				action: 'lesson.resolve',
				subjectId: subject.id,
				summary: `${lessonName} を ${subject.name} に紐付けた`,
			},
			new Date(),
		);
		return {
			message: `${lessonName} を ${subject.name} に紐付けました (休講などの ${assigned} 件に科目を入れました)。`,
		};
	},
	/** 紐付けを外し、未解決に戻す。休講などに入れた科目も外す */
	unresolve: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const lessonName = await readLessonName(request);
		if (lessonName === null) return fail(400, { error: NO_NAME });
		const { subjects, unmatchedLessons, classChanges } = getServices();
		const academicYear = subjects.latestYear();
		if (academicYear === null) return fail(400, { error: NOT_IMPORTED });
		if (!unmatchedLessons.unresolve(academicYear, lessonName)) {
			return fail(400, { error: NOT_RECORDED });
		}
		const removed = classChanges.unassignSubject(lessonName);
		getServices().auditLog.record(
			{ actorId: admin.id, action: 'lesson.unresolve', summary: `${lessonName} の紐付けを外した` },
			new Date(),
		);
		return {
			message: `${lessonName} の紐付けを外しました (休講などの ${removed} 件から科目を外しました)。`,
		};
	},
	/** 科目にしないと決め、一覧から外す。紐付けていれば外す */
	ignore: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const lessonName = await readLessonName(request);
		if (lessonName === null) return fail(400, { error: NO_NAME });
		const { subjects, unmatchedLessons, classChanges } = getServices();
		const academicYear = subjects.latestYear();
		if (academicYear === null) return fail(400, { error: NOT_IMPORTED });
		if (!unmatchedLessons.ignore(academicYear, lessonName, new Date())) {
			return fail(400, { error: NOT_RECORDED });
		}
		classChanges.unassignSubject(lessonName);
		getServices().auditLog.record(
			{
				actorId: admin.id,
				action: 'lesson.ignore',
				summary: `${lessonName} を科目にしないことにした`,
			},
			new Date(),
		);
		return { message: `${lessonName} を科目にしないことにしました。あとで一覧に戻せます。` };
	},
	/** 科目にしない決定を解き、未解決に戻す */
	restore: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const lessonName = await readLessonName(request);
		if (lessonName === null) return fail(400, { error: NO_NAME });
		const { subjects, unmatchedLessons } = getServices();
		const academicYear = subjects.latestYear();
		if (academicYear === null) return fail(400, { error: NOT_IMPORTED });
		if (!unmatchedLessons.restore(academicYear, lessonName)) {
			return fail(400, { error: NOT_RECORDED });
		}
		getServices().auditLog.record(
			{
				actorId: admin.id,
				action: 'lesson.restore',
				summary: `${lessonName} を、照合できなかった授業名の一覧に戻した`,
			},
			new Date(),
		);
		return { message: `${lessonName} を、照合できなかった授業名の一覧に戻しました。` };
	},
};
