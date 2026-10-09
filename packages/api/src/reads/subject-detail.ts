// 授業の詳細。画面の授業の詳細と、公開 API・MCP の get_subject が、この関数を通して同じ科目を読む。
// 閲覧権限の判定は @funmary/core の canViewSubject に任せ、ここでは科目を探して組み立てるだけにする。
import { canViewSubject } from '@funmary/core';
import type {
	AccessGrantStore,
	ClassChangeStore,
	StoredSubject,
	SubjectClassChange,
	SubjectStore,
} from '@funmary/db';

export interface SubjectDetailSources {
	readonly subjects: Pick<SubjectStore, 'findBySyllabus'>;
	readonly accessGrants: Pick<AccessGrantStore, 'isGranted'>;
	readonly classChanges: Pick<ClassChangeStore, 'listBySubject'>;
}

export interface SubjectDetailViewer {
	readonly id: string;
	readonly email: string;
	readonly role: 'user' | 'moderator' | 'admin';
}

export interface SubjectDetail {
	readonly subject: StoredSubject;
	/** 休講、補講、教室変更の履歴 (新しい順) */
	readonly changes: readonly SubjectClassChange[];
}

/** シラバスの番号で科目を探し、閲覧権限を確かめて返す。見つからない、見えないときは null (同じ扱いにし、存在を漏らさない) */
export function getSubjectDetail(
	sources: SubjectDetailSources,
	key: { readonly academicYear: number; readonly syllabusId: string },
	viewer: SubjectDetailViewer,
): SubjectDetail | null {
	const subject = sources.subjects.findBySyllabus(key.academicYear, key.syllabusId);
	if (!subject) return null;
	const granted =
		subject.source === 'user' &&
		subject.visibility === 'private' &&
		sources.accessGrants.isGranted('subject', subject.id, viewer.email);
	if (!canViewSubject(subject, viewer, granted)) return null;
	return { subject, changes: sources.classChanges.listBySubject(subject.id) };
}
