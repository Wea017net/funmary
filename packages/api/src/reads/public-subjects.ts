// 科目の検索と、科目の全授業日。履修しているかどうかに関わらず、見られる科目を調べる。
import { canViewSubject, isSubjectSearchable, type CalendarDate } from '@funmary/core';
import type { AccessGrantStore, StoredSubject, SubjectStore } from '@funmary/db';
import { getPublicTimetable, type PublicLesson } from './public-data.ts';
import type { SubjectDetailViewer } from './subject-detail.ts';
import type { TimetableSources } from './user-timetable.ts';

/** 1 回の検索で返す科目の数の上限 */
export const SUBJECT_SEARCH_LIMIT = 50;

export interface PublicSubjectSummary {
	readonly academicYear: number;
	readonly syllabusId: string;
	readonly name: string;
	readonly teacher: string | null;
	readonly credits: number | null;
	readonly term: string;
}

export interface SubjectSearchSources {
	readonly subjects: Pick<SubjectStore, 'list'>;
}

const toSummary = (subject: StoredSubject): PublicSubjectSummary => ({
	academicYear: subject.academicYear,
	syllabusId: subject.syllabusId,
	name: subject.name,
	teacher: subject.teacher,
	credits: subject.credits,
	term: subject.term,
});

/**
 * 年度の科目を、名前、教員、授業コードで探す (大文字と小文字、前後の空白は区別しない)。
 * 「科目を探す」の画面と同じく、公開の科目だけを返す。term で学期を絞れる
 */
export function searchSubjects(
	sources: SubjectSearchSources,
	query: {
		readonly academicYear: number;
		readonly q?: string | undefined;
		readonly term?: string | undefined;
	},
): { subjects: PublicSubjectSummary[]; truncated: boolean } {
	const needle = query.q?.trim().toLowerCase() ?? '';
	const matched = sources.subjects
		.list(query.academicYear)
		.filter((subject) => isSubjectSearchable(subject))
		.filter((subject) => query.term === undefined || subject.term === query.term)
		.filter(
			(subject) =>
				needle === '' ||
				[subject.name, subject.teacher ?? '', subject.syllabusId].some((text) =>
					text.toLowerCase().includes(needle),
				),
		);
	return {
		subjects: matched.slice(0, SUBJECT_SEARCH_LIMIT).map(toSummary),
		truncated: matched.length > SUBJECT_SEARCH_LIMIT,
	};
}

export interface SubjectSessionSources extends TimetableSources {
	readonly subjects: TimetableSources['subjects'] & Pick<SubjectStore, 'findBySyllabus'>;
	readonly accessGrants: Pick<AccessGrantStore, 'isGranted'>;
}

export interface SubjectSession extends PublicLesson {
	/** 休講を除いた通し番号 (その年度の、実施される授業の順)。休講の回は null。シラバスの「第 n 回」とは限らない */
	readonly sequence: number | null;
}

/** 科目の、その年度の全授業日。休講、補講、教室変更を反映する。見られない科目と、ない科目は null */
export function getSubjectSessions(
	sources: SubjectSessionSources,
	key: { readonly academicYear: number; readonly syllabusId: string },
	viewer: SubjectDetailViewer,
): { subject: PublicSubjectSummary; sessions: SubjectSession[] } | null {
	const subject = sources.subjects.findBySyllabus(key.academicYear, key.syllabusId);
	if (!subject) return null;
	const granted =
		subject.source === 'user' &&
		subject.visibility === 'private' &&
		sources.accessGrants.isGranted('subject', subject.id, viewer.email);
	if (!canViewSubject(subject, viewer, granted)) return null;

	// 科目 1 つだけを履修している利用者がいるものとして、時間割の展開をそのまま使う
	const subjectOnly: TimetableSources = {
		...sources,
		courses: {
			listRegistrations: () => [{ subjectId: subject.id, hopeCourseUrl: null }],
			slotsOf: (subjectId) => sources.courses.slotsOf(subjectId),
		},
		personalSlots: { listForSubject: () => [] },
	};
	const range: { start: CalendarDate; end: CalendarDate } = {
		start: `${subject.academicYear}-04-01`,
		end: `${subject.academicYear + 1}-03-31`,
	};
	let sequence = 0;
	const sessions = getPublicTimetable(subjectOnly, viewer.id, range).lessons.map(
		(lesson): SubjectSession => ({
			...lesson,
			sequence: lesson.status === 'cancelled' ? null : ++sequence,
		}),
	);
	return { subject: toSummary(subject), sessions };
}
