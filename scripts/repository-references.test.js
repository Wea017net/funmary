import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import repository from '../repository.json' with { type: 'json' };
import { findRepositoryReferences } from './repository-references.js';

describe('findRepositoryReferences', () => {
	it('GitHub の URL、owner/repo の形、シェルの既定値から参照を拾う', () => {
		const text = [
			'https://github.com/funmary-app/funmary/issues',
			'git@github.com:otnc/funmary-mirror.git',
			'https://raw.githubusercontent.com/funmary-app/funmary/main/deploy/update.sh',
			'開発は [funmary-app/funmary](https://github.com/funmary-app/funmary) で',
			"if: github.repository == 'funmary-app/funmary'",
			'REPO="${FUNMARY_REPO:-funmary-app/funmary}"',
			'https://contrib.rocks/image?repo=funmary-app/funmary',
		].join('\n');
		expect(findRepositoryReferences(text)).toEqual([
			'funmary-app/funmary',
			'otnc/funmary-mirror',
			'funmary-app/funmary',
			'funmary-app/funmary',
			'funmary-app/funmary',
			'funmary-app/funmary',
			'funmary-app/funmary',
			'funmary-app/funmary',
		]);
	});

	it('パスやパッケージの名前は、参照として拾わない', () => {
		const text = [
			'/etc/funmary/funmary.env',
			'import { db } from "@funmary/db";',
			'/var/lib/funmary/backups',
			'funmary-admin',
		].join('\n');
		expect(findRepositoryReferences(text)).toEqual([]);
	});
});

describe('リポジトリの参照', () => {
	it('追跡しているファイルのリポジトリの参照が、repository.json の値と食い違っていない', () => {
		const allowed = new Set([repository.repository, repository.mirror]);
		const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
			.split('\0')
			.filter((file) => file !== '' && file !== 'pnpm-lock.yaml');
		const mismatches = files.flatMap((file) => {
			let text;
			try {
				text = readFileSync(file, 'utf8');
			} catch {
				// 作業ツリーで消したファイルは、git ls-files に残っていても読めない
				return [];
			}
			return findRepositoryReferences(text)
				.filter((reference) => !allowed.has(reference))
				.map((reference) => `${file}: ${reference}`);
		});
		expect(mismatches).toEqual([]);
	});
});
