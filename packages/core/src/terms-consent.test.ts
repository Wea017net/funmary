import { describe, expect, it } from 'vitest';
import { currentTermsVersion, hasAcceptedTerms } from './terms-consent.ts';

describe('currentTermsVersion', () => {
	it('2 つの最終更新日のうち、新しいほうを版にする', () => {
		expect(currentTermsVersion('2026-10-03', '2026-09-20')).toBe('2026-10-03');
		expect(currentTermsVersion('2026-09-20', '2026-10-03')).toBe('2026-10-03');
		expect(currentTermsVersion('2026-10-03', '2026-10-03')).toBe('2026-10-03');
	});
});

describe('hasAcceptedTerms', () => {
	it('いまの版に同意していれば true', () => {
		expect(hasAcceptedTerms('2026-10-03', '2026-10-03')).toBe(true);
	});

	it('一度も同意していないか、古い版への同意なら false', () => {
		expect(hasAcceptedTerms(null, '2026-10-03')).toBe(false);
		expect(hasAcceptedTerms('2026-09-20', '2026-10-03')).toBe(false);
	});
});
