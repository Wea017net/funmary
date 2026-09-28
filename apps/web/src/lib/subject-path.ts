// 授業の詳細の URL (/app/subjects/<年度>/<シラバスの番号>) の引数。DB の ID は作り直すと変わるので、URL には使わない。
// シラバスにない授業の番号は "user-" で始まる乱数 (英数字、- と _)。

export interface SubjectPathParams {
	readonly year: string;
	readonly code: string;
}

export function subjectPathParams(subject: {
	readonly academicYear: number;
	readonly syllabusId: string;
}): SubjectPathParams {
	return { year: String(subject.academicYear), code: subject.syllabusId };
}

/** URL の引数を読む。形が違えば null */
export function parseSubjectPath(params: {
	readonly year?: string;
	readonly code?: string;
}): { academicYear: number; syllabusId: string } | null {
	const { year = '', code = '' } = params;
	if (!/^\d{4}$/.test(year) || !/^[\w-]{1,40}$/.test(code)) return null;
	return { academicYear: Number(year), syllabusId: code };
}
