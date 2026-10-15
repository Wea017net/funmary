// npm に公開してよいパッケージを、3 つだけに固定する。公開しないパッケージが、private を外されて、誤って公開されないようにする。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

/** npm に公開するパッケージ (名前 → ディレクトリ) */
const PUBLISHED = new Map([
	['@funmary/client', 'packages/public/client'],
	['@funmary/mcp', 'packages/public/mcp'],
	['funmary', 'packages/public/funmary'],
]);

/**
 * @typedef {{
 *   name: string;
 *   version?: string;
 *   private?: boolean;
 *   license?: string;
 *   files?: string[];
 *   bin?: Record<string, string>;
 *   repository?: { url?: string };
 *   publishConfig?: { access?: string; provenance?: boolean; exports?: unknown; types?: string };
 *   dependencies?: Record<string, string>;
 *   peerDependencies?: Record<string, string>;
 * }} PackageJson
 */

/**
 * @param {string} dir 根からの、package.json のあるディレクトリ ('.' なら根)
 * @returns {PackageJson}
 */
function readPackage(dir) {
	/** @type {unknown} */
	const json = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));
	return /** @type {PackageJson} */ (json);
}

const workspaceDirs = ['apps', 'packages/public', 'packages/private'].flatMap((parent) =>
	readdirSync(join(root, parent), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => `${parent}/${entry.name}`),
);

describe('npm に公開するパッケージ', () => {
	it('公開してよいのは、決めた 3 つだけ。ほかは、すべて private', () => {
		const open = workspaceDirs
			.map((dir) => ({ dir, pkg: readPackage(dir) }))
			.filter(({ pkg }) => pkg.private !== true)
			.map(({ pkg }) => pkg.name)
			.toSorted();
		expect(open).toEqual([...PUBLISHED.keys()].toSorted());
	});

	it('根の package.json は private で、公開するパッケージの名前とぶつからない', () => {
		const rootPackage = readPackage('.');
		expect(rootPackage.private).toBe(true);
		expect(PUBLISHED.has(rootPackage.name)).toBe(false);
	});

	it.each([...PUBLISHED])(
		'%s は、公開の設定 (範囲、provenance、含めるファイル、ライセンス) がそろっている',
		(name, dir) => {
			const pkg = readPackage(dir);
			expect(pkg.name).toBe(name);
			expect(pkg.publishConfig).toMatchObject({ access: 'public', provenance: true });
			expect(pkg.files).toEqual(['dist']);
			expect(pkg.license).toBe('(BSD-3-Clause OR Apache-2.0)');
			// 公開する版の入口は、ビルドした dist を指す (開発では src を指す)
			expect(JSON.stringify(pkg.publishConfig?.exports)).toContain('dist/');
			// npm のサイトの TS の印は、exports ではなく、types の項目を見る
			expect(pkg.publishConfig?.types).toBe('./dist/index.d.ts');
			expect(pkg.repository?.url).toContain('funmary-app/funmary');
		},
	);

	it.each([...PUBLISHED])(
		'%s の版は、X.Y.Z の形 (公開のあと、ワークフローが書き込む)',
		(_name, dir) => {
			expect(readPackage(dir).version).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
		},
	);

	it('funmary は、コマンドのほかに、ライブラリの入口 (funmary、funmary/mcp) を出す', () => {
		const pkg = readPackage('packages/public/funmary');
		expect(Object.keys(pkg.publishConfig?.exports ?? {})).toEqual(
			expect.arrayContaining(['.', './mcp']),
		);
		expect(pkg.bin).toEqual({ funmary: './dist/bin.js' });
	});

	it('公開するパッケージが依存する、リポジトリ内のパッケージは、公開するものだけ', () => {
		for (const [, dir] of PUBLISHED) {
			const pkg = readPackage(dir);
			const internal = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }).filter(
				(name) => name.startsWith('@funmary/'),
			);
			for (const name of internal) expect(PUBLISHED.has(name), `${pkg.name} → ${name}`).toBe(true);
		}
	});
});
