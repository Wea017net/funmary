// 学年暦の確認と入力 (設計書 10 章、12.1)。大学の学年暦は PDF しかないので、管理者が学期の期間、振替授業日、
// 全学の休講日を入れる。入れていない学期は、既定の規則で推定した期間を使う。
import { fail, type Actions, type ServerLoad } from '@sveltejs/kit';
import { academicYearOf, jstDateTime, resolveAcademicTerms, TERMS } from '@funmary/core';
import { requireAdmin } from '$lib/server/admin.ts';
import {
	academicYearRange,
	parseAcademicYear,
	parseDateKey,
	parseNoClassDayForm,
	parseSubstituteDayForm,
	parseTermForm,
	parseTermKey,
} from '$lib/server/calendar-form.ts';
import { getServices } from '$lib/server/services.ts';

/** 画面を開いた年度。?year= がなければ今日の年度 */
function yearOf(url: URL): number {
	return parseAcademicYear(
		url.searchParams.get('year'),
		academicYearOf(jstDateTime(new Date()).date),
	);
}

export const load: ServerLoad = ({ locals, url }) => {
	requireAdmin(locals);
	const { academicCalendar } = getServices();
	const academicYear = yearOf(url);
	const range = academicYearRange(academicYear);
	const resolved = new Map(
		resolveAcademicTerms(academicYear, academicCalendar.listTerms(academicYear)).map((term) => [
			term.term,
			term,
		]),
	);
	return {
		academicYear,
		range,
		// 学期は、決まっていないものも含めて、選択肢と同じ順に並べる
		terms: TERMS.map((term) => {
			const period = resolved.get(term);
			return period
				? { term, start: period.start, end: period.end, source: period.source }
				: { term, start: null, end: null, source: null };
		}),
		substituteDays: academicCalendar.listSubstituteDays(range.start, range.end),
		noClassDays: academicCalendar.listNoClassDays(range.start, range.end),
	};
};

export const actions: Actions = {
	saveTerm: async ({ request, locals, url }) => {
		requireAdmin(locals);
		const academicYear = yearOf(url);
		const parsed = parseTermForm(await request.formData(), academicYear);
		if (!parsed.ok) return fail(400, { error: parsed.error });
		getServices().academicCalendar.saveTerm(academicYear, parsed.value, 'manual', new Date());
		return { message: '学期の期間を保存しました。' };
	},
	deleteTerm: async ({ request, locals, url }) => {
		requireAdmin(locals);
		const term = parseTermKey(await request.formData());
		if (term === null) return fail(400, { error: '学期を選んでください。' });
		getServices().academicCalendar.deleteTerm(yearOf(url), term);
		return {
			message: '学期の期間を消しました。前期と後期は、既定の規則で推定した期間に戻ります。',
		};
	},
	saveSubstituteDay: async ({ request, locals, url }) => {
		requireAdmin(locals);
		const parsed = parseSubstituteDayForm(await request.formData(), yearOf(url));
		if (!parsed.ok) return fail(400, { error: parsed.error });
		getServices().academicCalendar.saveSubstituteDay(parsed.value, 'manual');
		return { message: '振替授業日を保存しました。' };
	},
	deleteSubstituteDay: async ({ request, locals, url }) => {
		requireAdmin(locals);
		const date = parseDateKey(await request.formData(), yearOf(url));
		if (date === null) return fail(400, { error: '日付がありません。' });
		getServices().academicCalendar.deleteSubstituteDay(date);
		return { message: '振替授業日を消しました。' };
	},
	saveNoClassDay: async ({ request, locals, url }) => {
		requireAdmin(locals);
		const parsed = parseNoClassDayForm(await request.formData(), yearOf(url));
		if (!parsed.ok) return fail(400, { error: parsed.error });
		getServices().academicCalendar.saveNoClassDay(parsed.value.date, parsed.value.label, 'manual');
		return { message: '全学の休講日を保存しました。' };
	},
	deleteNoClassDay: async ({ request, locals, url }) => {
		requireAdmin(locals);
		const date = parseDateKey(await request.formData(), yearOf(url));
		if (date === null) return fail(400, { error: '日付がありません。' });
		getServices().academicCalendar.deleteNoClassDay(date);
		return { message: '全学の休講日を消しました。' };
	},
};
