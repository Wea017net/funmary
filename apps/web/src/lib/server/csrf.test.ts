import { describe, expect, it } from 'vitest';
import { isCsrfForbidden } from './csrf.ts';

const SELF = 'https://funmary.example.com';
const base = {
	method: 'POST',
	path: '/app/settings',
	contentType: 'application/x-www-form-urlencoded',
	origin: SELF,
	selfOrigin: SELF,
};

describe('isCsrfForbidden', () => {
	it('同じ Origin の form は通す', () => {
		expect(isCsrfForbidden(base)).toBe(false);
	});

	it('別のサイトからの form と、Origin のない form は断る', () => {
		expect(isCsrfForbidden({ ...base, origin: 'https://evil.example' })).toBe(true);
		expect(isCsrfForbidden({ ...base, origin: null })).toBe(true);
	});

	it('Content-Type のない POST も、form と同じに扱う', () => {
		expect(isCsrfForbidden({ ...base, contentType: null, origin: null })).toBe(true);
	});

	it('JSON と GET は、Origin を見ない', () => {
		expect(isCsrfForbidden({ ...base, contentType: 'application/json', origin: null })).toBe(false);
		expect(isCsrfForbidden({ ...base, method: 'GET', origin: null })).toBe(false);
	});

	it('OAuth のトークンの口だけは、Origin のない form を通す', () => {
		expect(isCsrfForbidden({ ...base, path: '/oauth/token', origin: null })).toBe(false);
		expect(isCsrfForbidden({ ...base, path: '/oauth/authorize', origin: null })).toBe(true);
	});
});
