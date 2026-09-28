// 学年暦の管理画面 (/admin/calendar) のフォームの値の検査 (設計書 10 章)。管理者のブラウザから来る値でも、信用しない。
import { isTerm, type CalendarDate, type Term, type Weekday } from '@funmary/core';
import * as v from 'valibot';
import { parseDateParam } from './date-param.ts';

/** 行事名の文字数の上限 */
const MAX_LABEL_LENGTH = 100;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

type FormResult<T> =
	{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

/** URL の年度を読む。範囲の外や形の違うものは fallback */
export function parseAcademicYear(value: string | null, fallback: number): number {
	if (value === null || !/^\d{4}$/.test(value)) return fallback;
	const year = Number(value);
	return year >= MIN_YEAR && year <= MAX_YEAR ? year : fallback;
}

/** 年度の最初の日と最後の日 */
export function academicYearRange(academicYear: number): {
	start: CalendarDate;
	end: CalendarDate;
} {
	return { start: `${academicYear}-04-01`, end: `${academicYear + 1}-03-31` };
}

/** 年度の中の、暦にある日付 */
function dateInYear(academicYear: number) {
	const range = academicYearRange(academicYear);
	return v.pipe(
		v.string('日付を入れてください'),
		v.check((text) => parseDateParam(text) !== null, '日付を入れてください'),
		v.check(
			(text) => range.start <= text && text <= range.end,
			`日付は ${academicYear} 年度 (${range.start} から ${range.end}) の中にしてください`,
		),
	);
}

const TermSchema = v.pipe(
	v.string('学期を選んでください'),
	v.check(isTerm, '学期を選んでください'),
);

function firstIssue<T>(result: v.SafeParseResult<v.GenericSchema<unknown, T>>): FormResult<T> {
	if (result.success) return { ok: true, value: result.output };
	return { ok: false, error: result.issues[0].message };
}

export function parseTermForm(
	form: FormData,
	academicYear: number,
): FormResult<{ term: Term; start: CalendarDate; end: CalendarDate }> {
	const schema = v.pipe(
		v.object({
			term: TermSchema,
			start: dateInYear(academicYear),
			end: dateInYear(academicYear),
		}),
		v.check((period) => period.start <= period.end, '始まりの日は、終わりの日より前にしてください'),
		v.transform((period) => ({ ...period, term: period.term as Term })),
	);
	return firstIssue(
		v.safeParse(schema, {
			term: form.get('term'),
			start: form.get('start'),
			end: form.get('end'),
		}),
	);
}

/**
 * 年の格子で選んだ日を、学期の始まりか終わりにする。current はその学期の今の期間 (推定を含む)。
 * 期間がまだなければ、その 1 日だけの期間にし、続けてもう一方の端を選んでもらう
 */
export function parseTermEdgeForm(
	form: FormData,
	academicYear: number,
	current: { readonly start: CalendarDate; readonly end: CalendarDate } | null,
): FormResult<{ term: Term; start: CalendarDate; end: CalendarDate }> {
	const schema = v.object({
		term: TermSchema,
		edge: v.picklist(['start', 'end'], '始まりか終わりかを選んでください'),
		date: dateInYear(academicYear),
	});
	const parsed = firstIssue(
		v.safeParse(schema, { term: form.get('term'), edge: form.get('edge'), date: form.get('date') }),
	);
	if (!parsed.ok) return parsed;
	const { term, edge, date } = parsed.value;
	const start = edge === 'start' ? date : (current?.start ?? date);
	const end = edge === 'end' ? date : (current?.end ?? date);
	if (start > end) {
		return { ok: false, error: '始まりの日は、終わりの日より前にしてください' };
	}
	return { ok: true, value: { term: term as Term, start, end } };
}

/** 削除する学期 */
export function parseTermKey(form: FormData): Term | null {
	const value = form.get('term');
	return typeof value === 'string' && isTerm(value) ? value : null;
}

export function parseSubstituteDayForm(
	form: FormData,
	academicYear: number,
): FormResult<{ date: CalendarDate; weekday: Weekday }> {
	const schema = v.object({
		date: dateInYear(academicYear),
		weekday: v.pipe(
			v.string('曜日を選んでください'),
			v.regex(/^[1-6]$/, '曜日は月曜から土曜の中から選んでください'),
			v.transform((text) => Number(text) as Weekday),
		),
	});
	return firstIssue(v.safeParse(schema, { date: form.get('date'), weekday: form.get('weekday') }));
}

export function parseNoClassDayForm(
	form: FormData,
	academicYear: number,
): FormResult<{ date: CalendarDate; label: string | null }> {
	const schema = v.object({
		date: dateInYear(academicYear),
		label: v.pipe(
			v.optional(v.string(), ''),
			v.trim(),
			v.maxLength(MAX_LABEL_LENGTH, `行事名は ${MAX_LABEL_LENGTH} 文字までにしてください`),
			v.regex(/^\P{Cc}*$/u, '行事名に改行などの制御文字は使えません'),
			v.transform((text) => (text === '' ? null : text)),
		),
	});
	return firstIssue(
		v.safeParse(schema, { date: form.get('date'), label: form.get('label') ?? undefined }),
	);
}

/** 削除する日付 (年度の中の日付) */
export function parseDateKey(form: FormData, academicYear: number): CalendarDate | null {
	const result = v.safeParse(dateInYear(academicYear), form.get('date'));
	return result.success ? result.output : null;
}
