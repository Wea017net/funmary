import { describe, expect, it } from 'vitest';
import {
	parseAcademicYear,
	parseNoClassDayForm,
	parseSubstituteDayForm,
	parseTermForm,
	parseTermKey,
} from './calendar-form.ts';

function form(values: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(values)) data.set(key, value);
	return data;
}

describe('parseAcademicYear', () => {
	it('2000 年度から 2100 年度までの年度を読む。なければ既定の年度', () => {
		expect(parseAcademicYear('2027', 2026)).toBe(2027);
		expect(parseAcademicYear(null, 2026)).toBe(2026);
		for (const bad of ['1999', '2101', '26', 'abc', '2026.5', '']) {
			expect(parseAcademicYear(bad, 2026)).toBe(2026);
		}
	});
});

describe('parseTermForm', () => {
	const valid = { term: 'fall', start: '2026-09-24', end: '2027-01-21' };

	it('学期と期間を読む', () => {
		expect(parseTermForm(form(valid), 2026)).toEqual({
			ok: true,
			value: { term: 'fall', start: '2026-09-24', end: '2027-01-21' },
		});
	});

	it('知らない学期は受け付けない', () => {
		expect(parseTermForm(form({ ...valid, term: 'autumn' }), 2026)).toEqual({
			ok: false,
			error: '学期を選んでください',
		});
	});

	it('暦にない日付や、始まりが終わりより後の期間は受け付けない', () => {
		expect(parseTermForm(form({ ...valid, start: '2026-09-31' }), 2026).ok).toBe(false);
		expect(parseTermForm(form({ ...valid, start: '2027-01-22' }), 2026)).toEqual({
			ok: false,
			error: '始まりの日は、終わりの日より前にしてください',
		});
	});

	it('年度 (4 月 1 日から翌年の 3 月 31 日) の外の日付は受け付けない', () => {
		expect(parseTermForm(form({ ...valid, start: '2026-03-31' }), 2026)).toEqual({
			ok: false,
			error: '日付は 2026 年度 (2026-04-01 から 2027-03-31) の中にしてください',
		});
		expect(parseTermForm(form({ ...valid, end: '2027-04-01' }), 2026).ok).toBe(false);
	});
});

describe('parseTermKey', () => {
	it('削除する学期を読む', () => {
		expect(parseTermKey(form({ term: 'q1' }))).toBe('q1');
		expect(parseTermKey(form({ term: 'x' }))).toBeNull();
	});
});

describe('parseSubstituteDayForm', () => {
	it('日付と、その日に行う曜日 (月曜から土曜) を読む', () => {
		expect(parseSubstituteDayForm(form({ date: '2026-10-14', weekday: '1' }), 2026)).toEqual({
			ok: true,
			value: { date: '2026-10-14', weekday: 1 },
		});
		for (const weekday of ['0', '7', 'x']) {
			expect(parseSubstituteDayForm(form({ date: '2026-10-14', weekday }), 2026).ok).toBe(false);
		}
		expect(parseSubstituteDayForm(form({ date: '2027-04-01', weekday: '1' }), 2026).ok).toBe(false);
	});
});

describe('parseNoClassDayForm', () => {
	it('日付と、行事名 (空なら null) を読み、前後の空白を除く', () => {
		expect(parseNoClassDayForm(form({ date: '2026-10-24', label: ' 大学祭 ' }), 2026)).toEqual({
			ok: true,
			value: { date: '2026-10-24', label: '大学祭' },
		});
		expect(parseNoClassDayForm(form({ date: '2026-10-24', label: '' }), 2026)).toEqual({
			ok: true,
			value: { date: '2026-10-24', label: null },
		});
	});

	it('長すぎる行事名や、制御文字を含む行事名は受け付けない', () => {
		expect(
			parseNoClassDayForm(form({ date: '2026-10-24', label: 'あ'.repeat(101) }), 2026).ok,
		).toBe(false);
		expect(parseNoClassDayForm(form({ date: '2026-10-24', label: '大学\n祭' }), 2026).ok).toBe(
			false,
		);
	});
});
