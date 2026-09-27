import { describe, expect, it } from 'vitest';
import { searchSubjects } from './subject-search.ts';

const subjects = [
	{ id: 1, name: '情報処理演習Ⅱ1-AB', syllabusId: '100001', teacher: '架空 一郎' },
	{ id: 2, name: '認知科学1～4', syllabusId: '100002', teacher: '架空 花子' },
	{ id: 3, name: 'コミュニケーションII1-J', syllabusId: '100003', teacher: null },
	{ id: 4, name: '応用情報処理', syllabusId: '100004', teacher: '架空 一郎' },
];

const ids = (found: readonly { id: number }[]) => found.map((s) => s.id);

describe('searchSubjects', () => {
	it('空の検索語では、何も返さない', () => {
		expect(searchSubjects(subjects, '   ')).toEqual([]);
	});

	it('科目名の一部で探し、名前の先頭で合うものを先に並べる', () => {
		expect(ids(searchSubjects(subjects, '情報処理'))).toEqual([1, 4]);
	});

	it('全角と半角、ローマ数字、波ダッシュの違いを気にせずに探せる', () => {
		expect(ids(searchSubjects(subjects, '情報処理演習II'))).toEqual([1]);
		expect(ids(searchSubjects(subjects, 'コミュニケーションⅡ'))).toEqual([3]);
		expect(ids(searchSubjects(subjects, '認知科学1~4'))).toEqual([2]);
		expect(ids(searchSubjects(subjects, '１－ａｂ'))).toEqual([1]);
	});

	it('空白を挟んでも探せる', () => {
		expect(ids(searchSubjects(subjects, '認知 科学'))).toEqual([2]);
	});

	it('教員の名前と、シラバスの番号でも探せる', () => {
		expect(ids(searchSubjects(subjects, '架空一郎'))).toEqual([1, 4]);
		expect(ids(searchSubjects(subjects, '100003'))).toEqual([3]);
	});

	it('件数の上限を超えた分は返さない', () => {
		expect(ids(searchSubjects(subjects, '架空', 2))).toEqual([1, 2]);
	});
});
