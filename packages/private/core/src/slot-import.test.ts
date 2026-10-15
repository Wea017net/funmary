import { describe, expect, it } from 'vitest';
import type { SubjectName } from './lesson-matching.ts';
import { planSlotImport, subjectsInSemester, type TimetableCell } from './slot-import.ts';

// 公開シラバスの科目名は「科目名 + クラス」の形 (例: 架空演習1-AB)
const subjects: SubjectName[] = [
	{ id: 1, name: '架空演習1-AB' },
	{ id: 2, name: '架空演習1-CD' },
	{ id: 3, name: '架空概論Ⅱ1～4' },
	{ id: 4, name: '架空設計論3' },
];

const cell = (over: Partial<TimetableCell> = {}): TimetableCell => ({
	weekday: 1,
	period: 1,
	subject: '架空演習',
	classes: '1-AB',
	rooms: ['363'],
	...over,
});

describe('planSlotImport', () => {
	it('科目名とクラスをつなげた名前で、科目と照合する', () => {
		const plan = planSlotImport(
			[cell(), cell({ classes: '1-CD', period: 2, rooms: ['364'] })],
			subjects,
		);
		expect(plan.slots).toEqual([
			{
				subjectId: 1,
				weekday: 1,
				period: 1,
				room: '363',
				lessonName: '架空演習1-AB',
				method: 'exact',
			},
			{
				subjectId: 2,
				weekday: 1,
				period: 2,
				room: '364',
				lessonName: '架空演習1-CD',
				method: 'exact',
			},
		]);
		expect(plan.unmatched).toEqual([]);
	});

	it('表記の揺れ (Ⅱ と II、全角と半角) は、正規化して照合する', () => {
		const plan = planSlotImport([cell({ subject: '架空概論II', classes: '1〜4' })], subjects);
		expect(plan.slots).toEqual([expect.objectContaining({ subjectId: 3, method: 'normalized' })]);
	});

	it('同じ科目の同じコマが複数の行にあれば、1 つにまとめ、部屋を重ねずに並べる', () => {
		const plan = planSlotImport(
			[
				cell({ rooms: ['363', '364'] }),
				// 教員ごとに行が分かれていることがある
				cell({ rooms: ['364', 'アトリエ'] }),
			],
			subjects,
		);
		expect(plan.slots).toEqual([
			expect.objectContaining({ subjectId: 1, room: '363,364,アトリエ' }),
		]);
	});

	it('部屋が書かれていなければ、教室は null にする', () => {
		const plan = planSlotImport([cell({ rooms: [] })], subjects);
		expect(plan.slots).toEqual([expect.objectContaining({ room: null })]);
	});

	it('照合できない名前と、決められない名前は、枠にせず、名前ごとに 1 つだけ返す', () => {
		const plan = planSlotImport(
			[
				cell({ subject: 'まったく別の授業', classes: '2' }),
				cell({ subject: 'まったく別の授業', classes: '2', period: 3 }),
				// 同じ名前の科目が 2 つあれば、決めない
				cell({ subject: '架空演習', classes: '1-AB' }),
			],
			[...subjects, { id: 9, name: '架空演習1-AB' }],
		);
		expect(plan.slots).toEqual([]);
		expect(plan.unmatched).toEqual([
			{ lessonName: 'まったく別の授業2', reason: 'unmatched' },
			{ lessonName: '架空演習1-AB', reason: 'ambiguous' },
		]);
	});

	it('似た名前でしか照合できなければ、枠にせず、候補を添えて人の確認へ回す (クラス違いの科目を選んでしまうため)', () => {
		const plan = planSlotImport(
			[
				// 1-EF の科目はまだないが、1-AB の科目と名前が 2 文字しか違わない
				cell({ subject: '架空の情報表現基礎演習', classes: '1-EF' }),
				// 演習と講義も、名前が近い
				cell({ subject: '架空の情報表現基礎', classes: '1-AB' }),
			],
			[{ id: 1, name: '架空の情報表現基礎演習1-AB' }],
		);
		expect(plan.slots).toEqual([]);
		expect(plan.unmatched).toEqual([
			{ lessonName: '架空の情報表現基礎演習1-EF', reason: 'similar', candidateId: 1 },
			{ lessonName: '架空の情報表現基礎1-AB', reason: 'similar', candidateId: 1 },
		]);
	});

	it('クラスが書かれていなければ、科目名だけで照合する', () => {
		const plan = planSlotImport([cell({ subject: '架空設計論3', classes: null })], subjects);
		expect(plan.slots).toEqual([
			expect.objectContaining({ subjectId: 4, lessonName: '架空設計論3' }),
		]);
	});

	it('曜日と時限が範囲の外のコマは、枠にしない', () => {
		const plan = planSlotImport([cell({ weekday: 0 }), cell({ period: 7 })], subjects);
		expect(plan.slots).toEqual([]);
	});
});

describe('subjectsInSemester', () => {
	const all = [
		{ id: 1, term: 'full-year' },
		{ id: 2, term: 'spring' },
		{ id: 3, term: 'q1' },
		{ id: 4, term: 'q2' },
		{ id: 5, term: 'fall' },
		{ id: 6, term: 'q3' },
		{ id: 7, term: 'q4' },
		{ id: 8, term: 'summer-intensive' },
	];

	it('前期の時間割には、通年、前期、1Q、2Q の科目だけを候補にする (前期と後期に同じ名前の科目があるため)', () => {
		expect(subjectsInSemester(all, 'spring').map((s) => s.id)).toEqual([1, 2, 3, 4]);
	});

	it('後期の時間割には、通年、後期、3Q、4Q の科目だけを候補にする', () => {
		expect(subjectsInSemester(all, 'fall').map((s) => s.id)).toEqual([1, 5, 6, 7]);
	});

	it('学期が分からなければ、すべての科目を候補にする', () => {
		expect(subjectsInSemester(all, null)).toHaveLength(all.length);
	});
});

describe('planSlotImport: 管理者の紐付け', () => {
	it('管理者が紐付けた名前は、その科目の枠にする (照合より優先する)', () => {
		const plan = planSlotImport(
			[cell({ subject: '架空演習 (再)', classes: '1-AB' })],
			subjects,
			new Map([['架空演習 (再)1-AB', 1]]),
		);
		expect(plan.unmatched).toEqual([]);
		expect(plan.slots).toEqual([
			{
				subjectId: 1,
				weekday: 1,
				period: 1,
				room: '363',
				lessonName: '架空演習 (再)1-AB',
				method: 'manual',
			},
		]);
	});

	it('紐付けた科目が候補 (学期で絞ったもの) になければ、通常の照合に回す', () => {
		const plan = planSlotImport([cell()], subjects, new Map([['架空演習1-AB', 999]]));
		expect(plan.slots.map((s) => [s.subjectId, s.method])).toEqual([[1, 'exact']]);
	});
});

describe('planSlotImport: まとめて書かれたコマ', () => {
	const combined: SubjectName[] = [
		{ id: 10, name: '画像工学3-JKL' },
		{ id: 11, name: '画像工学4-GHI' },
		{ id: 12, name: 'アルゴリズムとデータ構造2-EF' },
		{ id: 13, name: 'アルゴリズムとデータ構造2-JKL' },
		{ id: 14, name: 'アルゴリズムとデータ構造2-ABCD' },
		{ id: 15, name: 'アルゴリズムとデータ構造2-GHI' },
	];

	it('カンマで区切ったクラスは、それぞれの科目に同じコマを付ける', () => {
		const plan = planSlotImport(
			[cell({ subject: '画像工学', classes: '3-JKL,4-GHI', rooms: ['593'] })],
			combined,
		);
		expect(plan.slots.map((slot) => [slot.subjectId, slot.method, slot.lessonName])).toEqual([
			[10, 'split', '画像工学3-JKL,4-GHI'],
			[11, 'split', '画像工学3-JKL,4-GHI'],
		]);
		expect(plan.unmatched).toEqual([]);
	});

	it('クラスの文字をまとめたものは、ちょうど重ならずに覆う科目があれば、それぞれに付ける', () => {
		const plan = planSlotImport(
			[cell({ subject: 'アルゴリズムとデータ構造', classes: '2-EFJKL' })],
			combined,
		);
		expect(plan.slots.map((slot) => slot.subjectId)).toEqual([12, 13]);
		expect(plan.unmatched).toEqual([]);
	});

	it('そのままの名前の科目があれば、分けない', () => {
		const plan = planSlotImport(
			[cell({ subject: 'アルゴリズムとデータ構造', classes: '2-ABCD' })],
			combined,
		);
		expect(plan.slots.map((slot) => [slot.subjectId, slot.method])).toEqual([[14, 'exact']]);
	});

	it('分けたものが 1 つでも決まらなければ、枠にせず人の確認へ回す', () => {
		const plan = planSlotImport(
			[
				// G だけの科目はない
				cell({ subject: 'アルゴリズムとデータ構造', classes: '2-EFG' }),
				cell({ subject: '画像工学', classes: '3-JKL,5-AB' }),
				cell({ subject: '架空特論', classes: 'M1,2' }),
			],
			combined,
		);
		expect(plan.slots).toEqual([]);
		expect(plan.unmatched.map((item) => item.lessonName)).toEqual([
			'アルゴリズムとデータ構造2-EFG',
			'画像工学3-JKL,5-AB',
			'架空特論M1,2',
		]);
	});
});
