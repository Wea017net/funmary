import { describe, expect, it } from 'vitest';
import { nextVersionTag } from './release-tag-version.js';

describe('nextVersionTag', () => {
	it('X.Y.Z をそのまま v を付けて返す', () => {
		expect(nextVersionTag('1.2.3', 'v0.9.0')).toBe('v1.2.3');
		expect(nextVersionTag('0.1.0', null)).toBe('v0.1.0');
	});

	it('patch/minor/major で、直前のタグから 1 つ上げる', () => {
		expect(nextVersionTag('patch', 'v0.2.3')).toBe('v0.2.4');
		expect(nextVersionTag('minor', 'v0.2.3')).toBe('v0.3.0');
		expect(nextVersionTag('major', 'v0.2.3')).toBe('v1.0.0');
	});

	it('直前のタグがなければ v0.0.0 を基準にする (最初の節目)', () => {
		expect(nextVersionTag('patch', null)).toBe('v0.0.1');
		expect(nextVersionTag('minor', null)).toBe('v0.1.0');
		expect(nextVersionTag('major', null)).toBe('v1.0.0');
	});

	it('知らない入力や、X.Y.Z でも patch/minor/major でもない値は断る', () => {
		expect(() => nextVersionTag('unknown', 'v0.1.0')).toThrow(/patch\/minor\/major/);
		expect(() => nextVersionTag('v1.2.3', 'v0.1.0')).toThrow(/patch\/minor\/major/);
		expect(() => nextVersionTag('1.2', 'v0.1.0')).toThrow(/patch\/minor\/major/);
	});

	it('直前のタグが X.Y.Z として読めなければ断る', () => {
		expect(() => nextVersionTag('patch', 'build-abc1234')).toThrow(/直前のタグ/);
	});
});
