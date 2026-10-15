import { describe, expect, it } from 'vitest';
import { canEditSubject, canViewSubject, isSubjectSearchable } from './subject-access.ts';

describe('canEditSubject', () => {
	const user = { id: 'u1', role: 'user' as const };
	const admin = { id: 'a1', role: 'admin' as const };

	it('足した科目は、足した人と管理者が直せる。シラバスの科目は誰も直せない', () => {
		expect(canEditSubject({ source: 'user', createdBy: 'u1' }, user)).toBe(true);
		expect(canEditSubject({ source: 'user', createdBy: 'u2' }, user)).toBe(false);
		expect(canEditSubject({ source: 'user', createdBy: null }, admin)).toBe(true);
		expect(canEditSubject({ source: 'syllabus', createdBy: null }, admin)).toBe(false);
	});
});

describe('canViewSubject', () => {
	const user = { id: 'u1', role: 'user' as const };
	const admin = { id: 'a1', role: 'admin' as const };

	it('シラバスの科目と、public、link は誰でも見られる', () => {
		for (const visibility of ['public', 'link'] as const) {
			expect(canViewSubject({ source: 'user', visibility, createdBy: 'u2' }, user)).toBe(true);
		}
		expect(
			canViewSubject({ source: 'syllabus', visibility: 'public', createdBy: null }, user),
		).toBe(true);
	});

	it('private は、足した人と管理者だけ見られる', () => {
		expect(canViewSubject({ source: 'user', visibility: 'private', createdBy: 'u1' }, user)).toBe(
			true,
		);
		expect(canViewSubject({ source: 'user', visibility: 'private', createdBy: 'u2' }, user)).toBe(
			false,
		);
		expect(canViewSubject({ source: 'user', visibility: 'private', createdBy: 'u2' }, admin)).toBe(
			true,
		);
	});
});

describe('isSubjectSearchable', () => {
	it('シラバスの科目と public だけ、探す一覧に出してよい', () => {
		expect(isSubjectSearchable({ source: 'syllabus', visibility: 'public' })).toBe(true);
		expect(isSubjectSearchable({ source: 'user', visibility: 'public' })).toBe(true);
		expect(isSubjectSearchable({ source: 'user', visibility: 'link' })).toBe(false);
		expect(isSubjectSearchable({ source: 'user', visibility: 'private' })).toBe(false);
	});
});
