// 履修登録の画面 (/courses) のフォームの値の検査。利用者のブラウザから来る値なので、信用しない。
// 曜日、時限、教室の検査は、公開 API と同じもの (@funmary/core の parseSlotInput) を通す。
import { parseSlotInput } from '@funmary/core';
import type { SharedSlotInput } from '@funmary/db';
import * as v from 'valibot';

const IdSchema = v.pipe(
	v.string('科目が選ばれていません'),
	v.regex(/^[1-9]\d{0,9}$/, '科目が選ばれていません'),
	v.transform((text) => Number(text)),
);

export function parseSubjectId(form: FormData): number | null {
	const result = v.safeParse(IdSchema, form.get('subjectId'));
	return result.success ? result.output : null;
}

export type SlotFieldsResult =
	| { readonly ok: true; readonly value: Omit<SharedSlotInput, 'subjectId'> }
	| { readonly ok: false; readonly error: string };

/** 曜日、時限、教室だけを検査する。科目は URL などから決まっていて、フォームには出さないときに使う */
export function parseSlotFields(form: FormData): SlotFieldsResult {
	return parseSlotInput({
		weekday: form.get('weekday'),
		period: form.get('period'),
		room: form.get('room') ?? undefined,
	});
}

export type SlotFormResult =
	| { readonly ok: true; readonly value: SharedSlotInput }
	| { readonly ok: false; readonly error: string };

/** 科目もフォームの値 (hidden の subjectId) から決めるとき使う */
export function parseSlotForm(form: FormData): SlotFormResult {
	const subject = v.safeParse(IdSchema, form.get('subjectId'));
	if (!subject.success) return { ok: false, error: subject.issues[0].message };
	const slot = parseSlotFields(form);
	return slot.ok ? { ok: true, value: { subjectId: subject.output, ...slot.value } } : slot;
}
