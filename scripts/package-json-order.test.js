// すべての package.json で、依存の欄を ほかの *Dependencies、dependencies、devDependencies の順に並べる
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const files = [
	'package.json',
	...['apps', 'packages'].flatMap((dir) =>
		readdirSync(join(root, dir), { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => `${dir}/${entry.name}/package.json`),
	),
];

/**
 * 依存の欄の並びの順位。dependencies と devDependencies のほかの *Dependencies を先にする
 * @param {string} key
 */
const rank = (key) => (key === 'devDependencies' ? 2 : key === 'dependencies' ? 1 : 0);

describe('package.json の依存の欄の順', () => {
	it.each(files)('%s', (file) => {
		/** @type {unknown} */
		const json = JSON.parse(readFileSync(join(root, file), 'utf8'));
		const pkg = /** @type {Record<string, unknown>} */ (json);
		const keys = Object.keys(pkg).filter(
			(key) => key.endsWith('Dependencies') || key === 'dependencies',
		);
		expect(keys).toEqual([...keys].sort((a, b) => rank(a) - rank(b)));
	});
});
