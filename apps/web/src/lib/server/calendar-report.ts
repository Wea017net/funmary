// 管理用コマンド calendar show の表示 (設計書 19.4)。学期の期間は値の出どころ付きで出す。
import type { ResolvedTerm, SubstituteDay, TermSource } from '@funmary/core';
import type { NoClassDay } from '@funmary/db';
import { formatTerm, WEEKDAY_LABELS } from '../term-label.ts';

const SOURCE_LABELS: Record<TermSource, string> = {
	manual: '手入力',
	auto: '学年暦から自動',
	estimated: '推定',
};

export interface CalendarReportInput {
	readonly academicYear: number;
	readonly terms: readonly ResolvedTerm[];
	readonly substituteDays: readonly SubstituteDay[];
	readonly noClassDays: readonly NoClassDay[];
}

/** 表示する行。項目がなければ (なし) を出す */
export function formatCalendarReport(input: CalendarReportInput): string[] {
	const section = (title: string, rows: string[]) => [
		title,
		...(rows.length > 0 ? rows : ['(なし)']).map((row) => `  ${row}`),
	];
	const weekday = (value: number) =>
		WEEKDAY_LABELS.find((day) => day.weekday === value)?.label ?? '?';
	return [
		`${input.academicYear} 年度の学年暦`,
		'',
		...section(
			'学期の期間',
			input.terms.map(
				(term) =>
					`${formatTerm(term.term)}  ${term.start} から ${term.end}  ${SOURCE_LABELS[term.source]}`,
			),
		),
		'',
		...section(
			'振替授業日',
			input.substituteDays.map((day) => `${day.date}  ${weekday(day.weekday)}曜の授業`),
		),
		'',
		...section(
			'全学の休講日',
			input.noClassDays.map((day) => (day.label ? `${day.date}  ${day.label}` : day.date)),
		),
	];
}
