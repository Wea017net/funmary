// 科目を見られるか、直せるか (設計書 11 章、14.9、Issue #164)。シラバスにない授業として
// 利用者や管理者が足した科目 (source が user) には、公開範囲 (visibility) がある。
// I/O を持たない、画面と公開 API の両方が使う純粋な判定だけをここに置く。

/** @funmary/db の SubjectVisibility と同じ形 (構造的に同じなので、型としてそのまま渡せる) */
type SubjectVisibility = 'public' | 'link' | 'private';

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
