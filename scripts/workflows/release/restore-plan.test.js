import { describe, expect, it } from 'vitest';
import { extractReleasedSha, planRestore } from './restore-plan.js';

const SHA_A = 'aad8566de4bb4028463e8a05bf94090ebda84eed';
const SHA_B = '002e3465dd7117e531740c69d806f69cdc4300c7';
const SHA_C = 'ca77eb6111111111111111111111111111111111';

describe('extractReleasedSha', () => {
	it('Release の実行のログから、リリースにしたコミット (HEAD_SHA) を取り出す', () => {
		const log = [
			'リリースの作成\tset up\t2026-10-01T10:41:00.0000000Z ##[group]Run actions/checkout',
			`リリースの作成\tbuild\t2026-10-01T10:41:05.0000000Z   HEAD_SHA: ${SHA_A}`,
			`リリースの作成\tbuild\t2026-10-01T10:41:06.0000000Z   HEAD_SHA: ${SHA_A}`,
		].join('\n');
		expect(extractReleasedSha(log)).toBe(SHA_A);
	});

	it('見つからなければ null を返す', () => {
		expect(extractReleasedSha('HEAD_SHA: not-a-sha')).toBeNull();
		expect(extractReleasedSha('')).toBeNull();
	});
});

describe('planRestore', () => {
	it('タグが残っていないコミットだけを、古い順に、重複なく返す', () => {
		expect(
			planRestore(
				// Release の実行は新しい順に届く。同じコミットを 2 回リリースしたこともある
				[SHA_B, SHA_C, SHA_B, SHA_A],
				new Set(['build-002e346']),
			),
		).toEqual([
			{ sha: SHA_A, version: 'build-aad8566' },
			{ sha: SHA_C, version: 'build-ca77eb6' },
		]);
	});
});
