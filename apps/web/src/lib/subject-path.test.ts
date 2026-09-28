import { describe, expect, it } from 'vitest';
import { parseSubjectPath, subjectPathParams } from './subject-path.ts';

describe('subjectPathParams', () => {
	it('年度とシラバスの番号を、URL の引数にする', () => {
		expect(subjectPathParams({ academicYear: 2026, syllabusId: '100201' })).toEqual({
			year: '2026',
			code: '100201',
		});
	});
});

describe('parseSubjectPath', () => {
	it('年度と番号を読む。シラバスにない授業の番号 (user-...) も読む', () => {
		expect(parseSubjectPath({ year: '2026', code: '100201' })).toEqual({
			academicYear: 2026,
			syllabusId: '100201',
		});
		expect(parseSubjectPath({ year: '2026', code: 'user-AbC_12-x' })).toEqual({
			academicYear: 2026,
			syllabusId: 'user-AbC_12-x',
		});
	});

	it('形の違うものは null', () => {
		expect(parseSubjectPath({ year: '26', code: '100201' })).toBeNull();
		expect(parseSubjectPath({ year: '2026', code: '../x' })).toBeNull();
		expect(parseSubjectPath({ year: '2026', code: '' })).toBeNull();
		expect(parseSubjectPath({ year: '2026', code: 'a'.repeat(41) })).toBeNull();
	});
});
