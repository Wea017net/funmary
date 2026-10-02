import { describe, expect, it } from 'vitest';
import { MARKER, confirmedComment, isExempt, isRepositoryName, requestComment } from './agreement.ts';

describe('isExempt', () => {
	it('リポジトリの持ち主、組織のメンバー、共同作業者と、Bot には同意を求めない', () => {
		for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
			expect(isExempt({ type: 'User', association })).toBe(true);
		}
		expect(isExempt({ type: 'Bot', association: 'NONE' })).toBe(true);
	});

	it('外部の人 (初めての人、前に貢献した人を含む) には同意を求める', () => {
		for (const association of ['CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER', 'NONE']) {
			expect(isExempt({ type: 'User', association })).toBe(false);
		}
	});
});

describe('コメントの文面', () => {
	it('案内と確認のコメントには、見分けるための印と、作者へのメンションを入れる', () => {
		const request = requestComment('student', 'https://license.example.workers.dev/agree?repo=a/b');
		expect(request).toContain(MARKER);
		expect(request).toContain('@student');
		expect(request).toContain('https://license.example.workers.dev/agree?repo=a/b');
		expect(confirmedComment('student')).toContain(MARKER);
	});
});

describe('isRepositoryName', () => {
	it('owner/repo の形だけを受け付ける', () => {
		expect(isRepositoryName('funmary-app/funmary')).toBe(true);
		expect(isRepositoryName('funmary-app/funmary/issues')).toBe(false);
		expect(isRepositoryName('../etc')).toBe(false);
		expect(isRepositoryName('a b/c')).toBe(false);
	});
});
