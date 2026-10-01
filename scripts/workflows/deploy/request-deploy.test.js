import { describe, expect, it } from 'vitest';
import { isDeployEnabled, parseReleasedSha } from './request-deploy.js';

describe('isDeployEnabled', () => {
	it('DEPLOY_ENABLED が false のときだけ止める', () => {
		expect(isDeployEnabled('false')).toBe(false);
	});

	it('未設定、空、true、そのほかの値では止めない (止めたいときは明示する)', () => {
		for (const value of [undefined, '', 'true', 'no']) {
			expect(isDeployEnabled(value)).toBe(true);
		}
	});
});

describe('parseReleasedSha', () => {
	it('Release が残したコミットの hash を読む (前後の空白と改行は除く)', () => {
		const sha = '002e3465dd7117e531740c69d806f69cdc4300c7';
		expect(parseReleasedSha(`${sha}\n`)).toBe(sha);
	});

	it('40 文字の 16 進数でなければ、読めないとして止める', () => {
		for (const text of ['', 'build-002e346', '002e346', 'not a sha']) {
			expect(() => parseReleasedSha(text)).toThrow(/released-sha/);
		}
	});
});
