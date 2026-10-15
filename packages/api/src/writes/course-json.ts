// 履修の書き込みの、REST の入出力の形 (Valibot)。OpenAPI の定義にもなる。
import * as v from 'valibot';
import type { CourseSummary, CourseWriteFailure } from './courses.ts';

const SyllabusId = v.pipe(v.string(), v.minLength(1), v.maxLength(64));
const AcademicYear = v.pipe(v.number(), v.integer(), v.minValue(2000), v.maxValue(2100));

/** 履修登録する科目の指し方。年度とシラバスの番号か、名前 (年度を省くと、今日が属する年度) */
export const CourseRefBodySchema = v.union([
	v.object({ academicYear: AcademicYear, syllabusId: SyllabusId }),
	v.object({
		name: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
		academicYear: v.optional(AcademicYear),
	}),
]);

/** パスの科目。年度とシラバスの番号 */
export const CoursePathParam = v.object({
	year: v.pipe(v.string(), v.regex(/^\d{4}$/), v.transform(Number)),
	syllabusId: SyllabusId,
});

export const PersonalSlotPathParam = v.object({
	...CoursePathParam.entries,
	weekday: v.pipe(v.string(), v.regex(/^\d$/), v.transform(Number)),
	period: v.pipe(v.string(), v.regex(/^\d$/), v.transform(Number)),
});

/** 自分だけの曜日と時限。範囲の検査は、画面と同じもの (@funmary/core の parseSlotInput) が行う */
export const PersonalSlotBodySchema = v.object({
	weekday: v.pipe(v.number(), v.description('1 (月) から 6 (土)')),
	period: v.pipe(v.number(), v.description('1 から 6')),
	room: v.optional(v.nullable(v.string()), null),
});

export const AbbreviationBodySchema = v.object({
	abbreviation: v.pipe(v.string(), v.description('100 文字まで。空にすると、正式名称を使う')),
});

const CourseSummarySchema = v.object({
	academicYear: v.number(),
	syllabusId: v.string(),
	name: v.string(),
	teacher: v.nullable(v.string()),
	credits: v.nullable(v.number()),
	term: v.string(),
});

/** 書き込んだあとの、その科目の自分の状態 */
export const CourseStateSchema = v.object({
	subject: CourseSummarySchema,
	registered: v.boolean(),
	personalSlots: v.array(
		v.object({ weekday: v.number(), period: v.number(), room: v.nullable(v.string()) }),
	),
	abbreviation: v.pipe(
		v.nullable(v.string()),
		v.description('保存した略称。保存していなければ null、正式名称に戻す指定なら空文字'),
	),
});

/** 失敗を、HTTP の状態と本文に直す */
export function courseFailureResponse(failure: CourseWriteFailure):
	| { readonly status: 400; readonly body: { error: 'invalid_request'; message: string } }
	| { readonly status: 404; readonly body: { error: 'not_found'; message: string } }
	| { readonly status: 409; readonly body: { error: 'not_registered'; message: string } }
	| {
			readonly status: 409;
			readonly body: {
				error: 'ambiguous';
				message: string;
				candidates: readonly CourseSummary[];
			};
	  } {
	switch (failure.kind) {
		case 'invalid':
			return { status: 400, body: { error: 'invalid_request', message: failure.error } };
		case 'not_found':
			return { status: 404, body: { error: 'not_found', message: failure.error } };
		case 'not_registered':
			return { status: 409, body: { error: 'not_registered', message: failure.error } };
		case 'ambiguous':
			return {
				status: 409,
				body: { error: 'ambiguous', message: failure.error, candidates: failure.candidates },
			};
	}
}
