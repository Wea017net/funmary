import { describe, expect, it } from 'vitest';
import { parseSlotFields, parseSlotForm, parseSubjectId } from './course-form.ts';

function form(values: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(values)) data.set(key, value);
	return data;
}

describe('parseSubjectId', () => {
	it('正の整数だけを科目の ID として受け取る', () => {
		expect(parseSubjectId(form({ subjectId: '12' }))).toBe(12);
		for (const bad of ['', '0', '-1', '1.5', '1e3', 'abc', ' 12']) {
			expect(parseSubjectId(form({ subjectId: bad }))).toBeNull();
		}
		expect(parseSubjectId(new FormData())).toBeNull();
	});
});

describe('parseSlotForm', () => {
	const valid = { subjectId: '3', weekday: '2', period: '4', room: ' 363 ' };

	it('曜日、時限、教室を読み、教室の前後の空白を除く', () => {
		expect(parseSlotForm(form(valid))).toEqual({
			ok: true,
			value: { subjectId: 3, weekday: 2, period: 4, room: '363' },
		});
	});

	it('教室が空なら null にする', () => {
		expect(parseSlotForm(form({ ...valid, room: '  ' }))).toEqual({
			ok: true,
			value: { subjectId: 3, weekday: 2, period: 4, room: null },
		});
	});

	it('月曜から土曜、1 限から 6 限の外は受け付けない', () => {
		for (const weekday of ['0', '7', 'x']) {
			expect(parseSlotForm(form({ ...valid, weekday })).ok).toBe(false);
		}
		for (const period of ['0', '7', '']) {
			expect(parseSlotForm(form({ ...valid, period })).ok).toBe(false);
		}
	});

	it('長すぎる教室名と、改行を含む教室名は受け付けない', () => {
		expect(parseSlotForm(form({ ...valid, room: 'あ'.repeat(101) })).ok).toBe(false);
		expect(parseSlotForm(form({ ...valid, room: '363\n364' })).ok).toBe(false);
	});
});

describe('parseSlotFields', () => {
	it('科目の ID を含めず、曜日、時限、教室だけを読む', () => {
		expect(parseSlotFields(form({ weekday: '2', period: '4', room: ' 363 ' }))).toEqual({
			ok: true,
			value: { weekday: 2, period: 4, room: '363' },
		});
	});

	it('曜日と時限の範囲は、parseSlotForm と同じ検査をする', () => {
		expect(parseSlotFields(form({ weekday: '0', period: '4', room: '' })).ok).toBe(false);
		expect(parseSlotFields(form({ weekday: '2', period: '7', room: '' })).ok).toBe(false);
	});
});
