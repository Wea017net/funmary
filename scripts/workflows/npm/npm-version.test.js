import { describe, expect, it } from 'vitest';
import { resolveNpmVersion } from './npm-version.js';

describe('resolveNpmVersion', () => {
	it('X.Y.Z は、そのまま使う。dist-tag は latest', () => {
		expect(resolveNpmVersion('1.0.0', '', [])).toEqual({
			version: '1.0.0',
			tag: 'latest',
			prerelease: false,
		});
	});

	it('先行版は、先行版の名前を dist-tag にする。指定があれば、それを使う', () => {
		expect(resolveNpmVersion('1.1.0-beta.0', '', [])).toEqual({
			version: '1.1.0-beta.0',
			tag: 'beta',
			prerelease: true,
		});
		expect(resolveNpmVersion('1.1.0-beta.0', 'next', []).tag).toBe('next');
		expect(resolveNpmVersion('1.1.0', 'next', []).prerelease).toBe(true);
	});

	it('patch、minor、major は、npm に公開されている版のうち、いちばん新しいものから上げる', () => {
		const published = ['1.2.3', '1.2.2', '1.1.9'];
		expect(resolveNpmVersion('patch', '', published).version).toBe('1.2.4');
		expect(resolveNpmVersion('minor', '', published).version).toBe('1.3.0');
		expect(resolveNpmVersion('major', '', published).version).toBe('2.0.0');
	});

	it('まだ公開されていなければ (確保しただけの 0.0.0-reserved を含む)、0.0.0 から上げる', () => {
		expect(resolveNpmVersion('major', '', []).version).toBe('1.0.0');
		expect(resolveNpmVersion('minor', '', ['0.0.0-reserved']).version).toBe('0.1.0');
		expect(resolveNpmVersion('patch', '', ['0.0.0-reserved', '0.0.0-stage']).version).toBe('0.0.1');
	});

	it('先行版の版は、上げる元に使わない (X.Y.Z の部分だけを見る)', () => {
		expect(resolveNpmVersion('patch', '', ['1.0.0-beta.1']).version).toBe('1.0.1');
	});

	it('読めない入力は、理由つきで断る', () => {
		expect(() => resolveNpmVersion('v1.0.0', '', [])).toThrow('patch/minor/major');
		expect(() => resolveNpmVersion('1.0', '', [])).toThrow('X.Y.Z');
		expect(() => resolveNpmVersion('', '', [])).toThrow();
	});
});
