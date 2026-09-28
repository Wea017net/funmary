import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findBuildInfo } from './build-info.ts';

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-build-info-'));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const info = {
	version: 'build-abc1234',
	commit: 'abc1234def5678abc1234def5678abc1234def56',
	buildNumber: 812,
	builtAt: '2026-09-28T04:00:00.000Z',
};

describe('findBuildInfo', () => {
	it('上の階層へたどって build-info.json を見つけて読む', () => {
		writeFileSync(join(dir, 'build-info.json'), JSON.stringify(info));
		const deep = join(dir, 'build', 'server', 'chunks');
		mkdirSync(deep, { recursive: true });
		expect(findBuildInfo(deep)).toEqual(info);
	});

	it('なければ null (手元の開発)', () => {
		expect(findBuildInfo(dir)).toBeNull();
	});

	it('形が違えば null', () => {
		writeFileSync(
			join(dir, 'build-info.json'),
			JSON.stringify({ ...info, version: 'evil<script>' }),
		);
		expect(findBuildInfo(dir)).toBeNull();
		writeFileSync(join(dir, 'build-info.json'), '{');
		expect(findBuildInfo(dir)).toBeNull();
	});
});
