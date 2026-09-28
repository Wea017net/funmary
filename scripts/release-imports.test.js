import { describe, expect, it } from 'vitest';
import { externalImports } from './release-imports.js';

describe('externalImports', () => {
	it('パッケージの読み込みだけを拾い、相対パスと Node.js の組み込みは除く', () => {
		const code = [
			"import { a } from './a.js';",
			'import fs from "node:fs";',
			"import path from 'path';",
			"import Database from 'better-sqlite3';",
			'import{encode}from"uqr";',
			"const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs');",
			"export { b } from '../b.js';",
			"import 'side-effect';",
		].join('\n');
		expect(externalImports(code)).toEqual([
			'better-sqlite3',
			'uqr',
			'pdfjs-dist/legacy/build/pdf.mjs',
			'side-effect',
		]);
	});
});

describe('externalImports が拾わないもの', () => {
	it('コメントと文字列の中の import、決まらない動的な import', () => {
		const code = [
			"// import { x } from 'drizzle-orm/sqlite-core';",
			'const text = "import y from \'fake\'";',
			'const url = "./pdf.worker.mjs";',
			'await import(url);',
			'const mod = await import(`${base}/x.js`);',
		].join('\n');
		expect(externalImports(code)).toEqual([]);
	});
});
