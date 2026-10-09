// 管理用コマンド calendar show と calendar import の表示。学期の期間は値の出どころ付きで出す。
import type { ResolvedTerm, SubstituteDay, TermSource } from '@funmary/core';
import type { NoClassDay } from '@funmary/db';
import type { AcademicCalendarImportReport } from './academic-calendar-import.ts';
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

/** 管理用コマンド calendar import の表示。PDF から読んだ内容と、書き込んだ結果を出す */
export function formatCalendarImportReport(
	report: Extract<AcademicCalendarImportReport, { kind: 'planned' }>,
): string[] {
	const [, ...body] = formatCalendarReport({
		academicYear: report.academicYear,
		terms: report.terms.map((term) => ({ ...term, source: 'auto' })),
		substituteDays: report.substituteDays,
		noClassDays: report.noClassDays,
	});
	const lines = [`学年暦の PDF から読んだ ${report.academicYear} 年度の内容`, ...body, ''];
	for (const warning of report.warnings) lines.push(`警告: ${warning}`);
	if (!report.applied) {
		lines.push(
			'確かめただけで、DB には書き込んでいません。書き込むには --apply を付けてください。',
		);
		return lines;
	}
	const { skippedTerms, skippedSubstituteDays, skippedNoClassDays } = report.applied;
	lines.push('書き込みました。祝日と重なる休講日は、祝日として扱われるので入れていません。');
	const skipped = [
		...skippedTerms.map(formatTerm),
		...skippedSubstituteDays.map((date) => `振替授業日 ${date}`),
		...skippedNoClassDays.map((date) => `休講日 ${date}`),
	];
	if (skipped.length > 0) {
		lines.push(`管理画面で入れた値があるので、上書きしなかったもの: ${skipped.join('、')}`);
	}
	return lines;
}
