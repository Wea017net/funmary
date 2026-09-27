// 履修登録の画面 (/courses) のフォームの値の検査。利用者のブラウザから来る値なので、信用しない。
import { DEFAULT_PERIODS } from '@funmary/core';
import type { SharedSlotInput } from '@funmary/db';
import * as v from 'valibot';

/** 教室名の文字数の上限。ポータルの時間割の取り込みと揃える */
const MAX_ROOM_LENGTH = 100;

const IdSchema = v.pipe(
	v.string('科目が選ばれていません'),
	v.regex(/^[1-9]\d{0,9}$/, '科目が選ばれていません'),
	v.transform((text) => Number(text)),
);

const SlotSchema = v.object({
	subjectId: IdSchema,
	weekday: v.pipe(
		v.string(),
		v.regex(/^[1-6]$/, '曜日は月曜から土曜の中から選んでください'),
		v.transform((text) => Number(text)),
	),
	period: v.pipe(
		v.string(),
		v.regex(/^\d$/, '時限を選んでください'),
		v.transform((text) => Number(text)),
		v.minValue(1, '時限を選んでください'),
		v.maxValue(DEFAULT_PERIODS.length, '時限を選んでください'),
	),
	room: v.pipe(
		v.optional(v.string(), ''),
		v.trim(),
		v.maxLength(MAX_ROOM_LENGTH, `教室名は ${MAX_ROOM_LENGTH} 文字までにしてください`),
		v.regex(/^\P{Cc}*$/u, '教室名に改行などの制御文字は使えません'),
		v.transform((text) => (text === '' ? null : text)),
	),
});

export function parseSubjectId(form: FormData): number | null {
	const result = v.safeParse(IdSchema, form.get('subjectId'));
	return result.success ? result.output : null;
}

export type SlotFormResult =
	| { readonly ok: true; readonly value: SharedSlotInput }
	| { readonly ok: false; readonly error: string };

export function parseSlotForm(form: FormData): SlotFormResult {
	const result = v.safeParse(SlotSchema, {
		subjectId: form.get('subjectId'),
		weekday: form.get('weekday'),
		period: form.get('period'),
		room: form.get('room') ?? undefined,
	});
	if (result.success) return { ok: true, value: result.output };
	return { ok: false, error: result.issues[0].message };
}
