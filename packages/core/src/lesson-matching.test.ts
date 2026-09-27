import { describe, expect, it } from 'vitest';
import { matchLessonName, matchLessonNames, type SubjectName } from './lesson-matching.ts';

const subjects: SubjectName[] = [
	{ id: 1, name: '線形代数 I' },
	{ id: 2, name: '線形代数 II' },
	{ id: 3, name: 'プログラミング基礎' },
	{ id: 4, name: 'Webプログラミング' },
	{ id: 5, name: 'データ構造とアルゴリズム' },
];

describe('matchLessonName: 完全一致と正規化', () => {
	it('授業名が完全に一致すれば、それを選ぶ', () => {
		expect(matchLessonName('線形代数 I', subjects)).toEqual({
			kind: 'matched',
			subjectId: 1,
			method: 'exact',
		});
	});

	it('全角と半角、大文字と小文字、空白の違いは、NFKC の正規化で一致にする', () => {
		expect(matchLessonName('ＷＥＢプログラミング', subjects)).toEqual({
			kind: 'matched',
			subjectId: 4,
			method: 'normalized',
		});
		expect(matchLessonName('プログラミング　基礎', subjects)).toEqual({
			kind: 'matched',
			subjectId: 3,
			method: 'normalized',
		});
	});

	it('授業名の末尾の "(旧:...)" を除いて一致させる', () => {
		expect(matchLessonName('データ構造とアルゴリズム(旧:データ構造)', subjects)).toEqual({
			kind: 'matched',
			subjectId: 5,
			method: 'old-name-removed',
		});
		expect(matchLessonName('データ構造とアルゴリズム （旧：情報処理）', subjects)).toMatchObject({
			kind: 'matched',
			subjectId: 5,
		});
	});

	it('同じ名前の科目が複数あれば、決められない (曖昧)', () => {
		const dup: SubjectName[] = [...subjects, { id: 9, name: '線形代数 I' }];
		expect(matchLessonName('線形代数 I', dup)).toEqual({ kind: 'ambiguous', reason: 'same-name' });
	});
});

describe('matchLessonName: 類似度', () => {
	it('1 位の類似度が閾値を超え、2 位と十分な差があるときだけ選ぶ', () => {
		// 1 文字だけ違う (誤字)
		expect(matchLessonName('データ構造とアルゴリズム論', subjects)).toEqual({
			kind: 'matched',
			subjectId: 5,
			method: 'similarity',
		});
	});

	it('似ている科目が 2 つあって差が小さいときは、決めずに曖昧とする (I と II の取り違えを防ぐ)', () => {
		// 番号が違う科目 (III と I、II) は、名前が似ていても別の科目なので、選ばない
		expect(matchLessonName('線形代数 III', subjects)).toEqual({ kind: 'unmatched' });

		const close: SubjectName[] = [
			{ id: 10, name: '情報システム基礎A' },
			{ id: 11, name: '情報システム基礎B' },
		];
		expect(matchLessonName('情報システム基礎C', close)).toEqual({
			kind: 'ambiguous',
			reason: 'close-candidates',
		});
	});

	it('波ダッシュと全角のチルダ、ハイフンと負号のような、取り違えやすい記号は同じ文字とみなす', () => {
		const withClass: SubjectName[] = [
			{ id: 30, name: '架空の科目1～4' },
			{ id: 31, name: '架空の演習1-AB' },
		];
		expect(matchLessonName('架空の科目1〜4', withClass)).toEqual({
			kind: 'matched',
			subjectId: 30,
			method: 'normalized',
		});
		expect(matchLessonName('架空の演習1−AB', withClass)).toEqual({
			kind: 'matched',
			subjectId: 31,
			method: 'normalized',
		});
	});

	it('末尾の番号が数字でも、番号が違えば別の科目として選ばない', () => {
		const numbered: SubjectName[] = [{ id: 20, name: '情報処理演習 2' }];
		expect(matchLessonName('情報処理演習 1', numbered)).toEqual({ kind: 'unmatched' });
		// 全角の数字も、NFKC で半角にしてから比べる
		expect(matchLessonName('情報処理演習１', numbered)).toEqual({ kind: 'unmatched' });
	});

	it('末尾の番号のあとに空白があっても、番号として比べる', () => {
		expect(matchLessonName('線形代数 III ', subjects)).toEqual({ kind: 'unmatched' });
	});

	it('似ていなければ、照合できない', () => {
		expect(matchLessonName('まったく別の授業', subjects)).toEqual({ kind: 'unmatched' });
	});

	it('科目が 1 つもなければ、照合できない。空の授業名も', () => {
		expect(matchLessonName('線形代数 I', [])).toEqual({ kind: 'unmatched' });
		expect(matchLessonName('', subjects)).toEqual({ kind: 'unmatched' });
	});
});

describe('matchLessonNames', () => {
	it('管理者が紐付けた名前を先に使い、残りを照合する。決められない名前は照合できなかったものに入れる', () => {
		const resolved = new Map([['線形代数 (再)', 2]]);
		expect(
			matchLessonNames(
				['線形代数 I', '線形代数 (再)', 'まったく別の授業', 'Webプログラミング'],
				subjects,
				resolved,
			),
		).toEqual({
			matched: [
				{ lessonName: '線形代数 I', subjectId: 1 },
				{ lessonName: '線形代数 (再)', subjectId: 2 },
				{ lessonName: 'Webプログラミング', subjectId: 4 },
			],
			unmatched: ['まったく別の授業'],
		});
	});

	it('同じ名前が何度出ても、1 回だけ照合する', () => {
		expect(matchLessonNames(['線形代数 I', '線形代数 I'], subjects, new Map())).toEqual({
			matched: [{ lessonName: '線形代数 I', subjectId: 1 }],
			unmatched: [],
		});
	});

	it('管理者が紐付けた科目が今の科目の一覧になければ、通常の照合に回す', () => {
		expect(matchLessonNames(['線形代数 I'], subjects, new Map([['線形代数 I', 999]]))).toEqual({
			matched: [{ lessonName: '線形代数 I', subjectId: 1 }],
			unmatched: [],
		});
	});
});
