import { describe, expect, it } from 'vitest';
import { canEditSubject, findSameName, parseUserSubjectForm } from './user-subject.ts';

const form = (entries: Record<string, string>) => {
	const data = new FormData();
	for (const [key, value] of Object.entries(entries)) data.set(key, value);
	return data;
};

describe('parseUserSubjectForm', () => {
	it('名前、学期、教員を読む。前後の空白を除き、教員が空なら null', () => {
		expect(
			parseUserSubjectForm(form({ name: ' キャリアガイダンス ', term: 'fall', teacher: '' })),
		).toEqual({ ok: true, value: { name: 'キャリアガイダンス', term: 'fall', teacher: null } });
	});

	it('名前がない、長すぎる、改行を含む、知らない学期は断る', () => {
		expect(parseUserSubjectForm(form({ name: '', term: 'fall' }))).toMatchObject({ ok: false });
		expect(parseUserSubjectForm(form({ name: 'あ'.repeat(101), term: 'fall' }))).toMatchObject({
			ok: false,
		});
		expect(parseUserSubjectForm(form({ name: 'a\nb', term: 'fall' }))).toMatchObject({ ok: false });
		expect(parseUserSubjectForm(form({ name: 'a', term: 'autumn' }))).toMatchObject({ ok: false });
	});
});

describe('findSameName', () => {
	const subjects = [
		{ id: 1, name: 'コミュニケーションI1-A' },
		{ id: 2, name: 'キャリアガイダンス' },
	];

	it('表記の揺れや略称を除いて同じ名前の科目を返す', () => {
		expect(findSameName('ｷｬﾘｱｶﾞｲﾀﾞﾝｽ', subjects)?.id).toBe(2);
		expect(findSameName('CommunicationI1-A', subjects)?.id).toBe(1);
	});

	it('似ているだけなら返さない', () => {
		expect(findSameName('キャリアデザイン', subjects)).toBeNull();
	});
});

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
