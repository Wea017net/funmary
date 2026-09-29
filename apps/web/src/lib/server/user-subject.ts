// シラバスにない授業として、利用者や管理者が足す科目 (source が user)。ブラウザから来る値は信用しない。
import { isTerm, matchLessonName, type SubjectName, type Term } from '@funmary/core';
import type { SubjectVisibility } from '@funmary/db';
import * as v from 'valibot';

const MAX_NAME_LENGTH = 100;
const MAX_TEACHER_LENGTH = 100;

type FormResult<T> =
	{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

const text = (label: string, max: number) =>
	v.pipe(
		v.string(),
		v.trim(),
		v.maxLength(max, `${label}は ${max} 文字までにしてください`),
		v.regex(/^\P{Cc}*$/u, `${label}に改行などの制御文字は使えません`),
	);

export function parseUserSubjectForm(
	form: FormData,
): FormResult<{ name: string; term: Term; teacher: string | null }> {
	const schema = v.object({
		name: v.pipe(text('名前', MAX_NAME_LENGTH), v.minLength(1, '名前を入れてください')),
		term: v.pipe(
			v.string('学期を選んでください'),
			v.check(isTerm, '学期を選んでください'),
			v.transform((value) => value as Term),
		),
		teacher: v.pipe(
			text('教員', MAX_TEACHER_LENGTH),
			v.transform((value) => (value === '' ? null : value)),
		),
	});
	const result = v.safeParse(schema, {
		name: form.get('name') ?? '',
		term: form.get('term'),
		teacher: form.get('teacher') ?? '',
	});
	return result.success
		? { ok: true, value: result.output }
		: { ok: false, error: result.issues[0].message };
}

/** 表記の揺れや略称を除いて同じ名前の科目。似ているだけのもの (類似度での一致) は含めない */
export function findSameName<T extends SubjectName>(
	name: string,
	subjects: readonly T[],
): T | null {
	const result = matchLessonName(name, subjects);
	if (result.kind !== 'matched' || result.method === 'similarity') return null;
	return subjects.find((subject) => subject.id === result.subjectId) ?? null;
}

/** 足した科目は、足した人と管理者が直したり消したりできる。シラバスの科目は直せない */
export function canEditSubject(
	subject: { readonly source: 'syllabus' | 'user'; readonly createdBy: string | null },
	user: { readonly id: string; readonly role: 'user' | 'moderator' | 'admin' },
): boolean {
	return subject.source === 'user' && (user.role === 'admin' || subject.createdBy === user.id);
}

/**
 * この科目を、URL を知っている利用者が開けるか (設計書 14.9、Issue #164)。
 * シラバスの科目と public、link は誰でも開ける。private は、足した人と管理者、
 * メールアドレスで招待された人 (granted、呼び出し側が事前に確かめる) だけ
 */
export function canViewSubject(
	subject: {
		readonly source: 'syllabus' | 'user';
		readonly visibility: SubjectVisibility;
		readonly createdBy: string | null;
	},
	user: { readonly id: string; readonly role: 'user' | 'moderator' | 'admin' },
	granted = false,
): boolean {
	if (subject.source === 'syllabus' || subject.visibility !== 'private') return true;
	return user.role === 'admin' || subject.createdBy === user.id || granted;
}

/** 「科目を探す」の一覧に出してよいか。public だけ (link は URL を知っている人だけ、private は誰にも出さない) */
export function isSubjectSearchable(subject: {
	readonly source: 'syllabus' | 'user';
	readonly visibility: SubjectVisibility;
}): boolean {
	return subject.source === 'syllabus' || subject.visibility === 'public';
}
