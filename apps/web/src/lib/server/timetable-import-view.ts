// 授業時間割の取り込みの結果を、管理画面に出す形にする。言い換えや分け方で決めた照合は、取り違えがないかを人が確かめる。
import type { TimetableImportReport } from './timetable-import.ts';

type Planned = Extract<TimetableImportReport, { kind: 'planned' }>;

const WEEKDAYS = ['', '月', '火', '水', '木', '金', '土', '日'];
const METHOD_LABELS = {
	exact: '完全一致',
	normalized: '表記の揺れを除いて一致',
	'old-name-removed': '旧名を除いて一致',
	alias: '略称を言い換えて一致',
	split: 'まとめて書かれたコマを分けて一致',
	manual: '管理画面で紐付け済み',
} as const;
const TERM_LABELS = { spring: '前期', fall: '後期' } as const;
const TO_CHECK: ReadonlySet<string> = new Set(['old-name-removed', 'alias', 'split']);

export interface TimetableImportView {
	readonly title: string;
	readonly warnings: readonly string[];
	readonly slotCount: number;
	readonly methodCounts: readonly { label: string; count: number }[];
	/** 人が確かめる照合 (略称の言い換え、旧名を除いたもの、まとめて書かれたコマを分けたもの) */
	readonly toCheck: readonly { lessonName: string; subject: string; slot: string }[];
	readonly unmatched: readonly { lessonName: string; reason: string }[];
	readonly applied: { summary: string; conflicts: readonly string[] } | null;
}

const slotLabel = (weekday: number, period: number) => `${WEEKDAYS[weekday]}曜 ${period} 限`;

export function toTimetableImportView(
	report: Planned,
	subjectName: (id: number) => string,
): TimetableImportView {
	const term = report.term ? TERM_LABELS[report.term] : '学期不明';
	const applied = report.applied;
	return {
		title: `${report.academicYear} 年度 ${term}の授業時間割`,
		warnings: report.warnings,
		slotCount: report.slots.length,
		methodCounts: Object.entries(METHOD_LABELS).map(([method, label]) => ({
			label,
			count: report.slots.filter((slot) => slot.method === method).length,
		})),
		toCheck: report.slots
			// 表記の揺れ (Ⅱ と II、全角と半角、空白) だけの違いは、取り違えようがないので出さない
			.filter((slot) => TO_CHECK.has(slot.method))
			.map((slot) => ({
				lessonName: slot.lessonName,
				subject: subjectName(slot.subjectId),
				slot: slotLabel(slot.weekday, slot.period),
			})),
		unmatched: report.unmatched.map((item) => ({
			lessonName: item.lessonName,
			reason:
				item.reason === 'similar'
					? `似た科目だけあり (${subjectName(item.candidateId)})`
					: item.reason === 'ambiguous'
						? '候補が複数'
						: '候補なし',
		})),
		applied: applied && {
			summary:
				`枠を ${applied.added} 件足し、空だった教室を ${applied.updated} 件埋めました。` +
				`照合できなかった名前を ${applied.newUnmatched} 件、新しく記録しました。`,
			conflicts: applied.conflicts.map(
				(c) =>
					`${subjectName(c.subjectId)} ${slotLabel(c.weekday, c.period)}: 登録済み ${c.existingRoom ?? '(なし)'}、PDF ${c.importedRoom ?? '(なし)'}`,
			),
		},
	};
}
