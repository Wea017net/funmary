import { describe, expect, it } from 'vitest';
import type { TimetableImportReport } from './timetable-import.ts';
import { toTimetableImportView } from './timetable-import-view.ts';

type Planned = Extract<TimetableImportReport, { kind: 'planned' }>;

const report: Planned = {
	kind: 'planned',
	academicYear: 2026,
	term: 'fall',
	warnings: ['部屋のあるコマが少なくなっています'],
	slots: [
		{ subjectId: 1, weekday: 1, period: 1, room: '363', lessonName: '代数学', method: 'exact' },
		{
			subjectId: 2,
			weekday: 2,
			period: 3,
			room: null,
			lessonName: '英語Ⅰ A',
			method: 'normalized',
		},
		{ subjectId: 3, weekday: 5, period: 2, room: '495', lessonName: '演習', method: 'manual' },
	],
	unmatched: [
		{ lessonName: '謎の科目', reason: 'unmatched' },
		{ lessonName: '情報表現', reason: 'similar', candidateId: 1 },
	],
	applied: null,
};

const names = new Map([
	[1, '代数学'],
	[2, '英語Ⅰ'],
	[3, '演習'],
]);
const subjectName = (id: number) => names.get(id) ?? `(科目 ${id})`;

describe('toTimetableImportView', () => {
	it('年度と学期、照合の方法ごとの数、人が確かめる照合、照合できなかった名前を出す', () => {
		expect(toTimetableImportView(report, subjectName)).toEqual({
			title: '2026 年度 後期の授業時間割',
			warnings: ['部屋のあるコマが少なくなっています'],
			slotCount: 3,
			methodCounts: [
				{ label: '完全一致', count: 1 },
				{ label: '表記の揺れを除いて一致', count: 1 },
				{ label: '旧名を除いて一致', count: 0 },
				{ label: '管理画面で紐付け済み', count: 1 },
			],
			toCheck: [{ lessonName: '英語Ⅰ A', subject: '英語Ⅰ', slot: '火曜 3 限' }],
			unmatched: [
				{ lessonName: '謎の科目', reason: '候補なし' },
				{ lessonName: '情報表現', reason: '似た科目だけあり (代数学)' },
			],
			applied: null,
		});
	});

	it('書き込んだ結果と、教室の食い違いを出す', () => {
		const view = toTimetableImportView(
			{
				...report,
				applied: {
					added: 2,
					updated: 1,
					newUnmatched: 1,
					conflicts: [
						{ subjectId: 1, weekday: 1, period: 1, existingRoom: '363', importedRoom: null },
					],
				},
			},
			subjectName,
		);
		expect(view.applied).toEqual({
			summary:
				'枠を 2 件足し、空だった教室を 1 件埋めました。照合できなかった名前を 1 件、新しく記録しました。',
			conflicts: ['代数学 月曜 1 限: 登録済み 363、PDF (なし)'],
		});
	});
});
