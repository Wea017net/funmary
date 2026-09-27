// 履修登録の画面で、科目を名前、教員、シラバスの番号で探す。
// 1 年度の科目は数百件なので、DB ではなくここで、表記の揺れを揃えてから比べる。

export interface SearchableSubject {
	readonly name: string;
	readonly syllabusId: string;
	readonly teacher: string | null;
}

/** 検索で返す件数の既定の上限 */
export const SEARCH_LIMIT = 30;

/** 全角と半角、ローマ数字 (Ⅱ と II)、波ダッシュとチルダ、ハイフンの類、大文字と小文字、空白の違いを揃える */
function normalize(text: string): string {
	return text
		.normalize('NFKC')
		.replace(/[〜∼]/gu, '~')
		.replace(/[‐-―−]/gu, '-')
		.replace(/\s+/gu, '')
		.toLowerCase();
}

/** 検索語に合う科目を返す。科目名の先頭で合うものを先にし、ほかは受け取った順のままにする */
export function searchSubjects<T extends SearchableSubject>(
	subjects: readonly T[],
	query: string,
	limit = SEARCH_LIMIT,
): T[] {
	const needle = normalize(query);
	if (needle === '') return [];
	const prefix: T[] = [];
	const rest: T[] = [];
	for (const subject of subjects) {
		const name = normalize(subject.name);
		if (name.startsWith(needle)) prefix.push(subject);
		else if (
			name.includes(needle) ||
			(subject.teacher !== null && normalize(subject.teacher).includes(needle)) ||
			subject.syllabusId === needle
		)
			rest.push(subject);
	}
	return [...prefix, ...rest].slice(0, limit);
}
