// SMUI のテーマ (src/theme) と、入れてある SMUI の部品のスタイルを、1 つの CSS に変換する (設計書 5.2)。
// ダーク用は色の CSS 変数だけで、端末の設定がダークのときだけ効くよう @media で囲んで後ろに足す。
// smui-theme の compile は、pnpm の置き方では入れた部品のスタイルを見つけられないので使わず、Sass を直接呼ぶ。
// pnpm dev と pnpm build の前に動かす。部品を足したら、ここで作り直される。
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sass from 'sass';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const output = join(webRoot, 'src/lib/styles/generated/smui.css');

/** @type {unknown} */
const manifest = JSON.parse(readFileSync(join(webRoot, 'package.json'), 'utf8'));
/** @param {string} key */
const dependencyNames = (key) => {
	const dependencies =
		typeof manifest === 'object' && manifest !== null && key in manifest
			? /** @type {Record<string, unknown>} */ (manifest)[key]
			: undefined;
	return typeof dependencies === 'object' && dependencies !== null ? Object.keys(dependencies) : [];
};
const smuiPackages = [...dependencyNames('dependencies'), ...dependencyNames('devDependencies')]
	.filter((name) => name.startsWith('@smui/') || name.startsWith('@smui-extra/'))
	.sort();

/**
 * pnpm は、各パッケージの依存を、そのパッケージの実体の隣 (.pnpm/<名前>/node_modules) に置く。その場所を返す
 * @param {string} dir
 */
const storeOf = (dir) => dirname(dirname(realpathSync(dir)));
const stores = [
	...new Set(smuiPackages.map((name) => storeOf(join(webRoot, 'node_modules', name)))),
];
// @smui/common は部品の依存で、apps/web からは直接見えない。どの部品からも同じ @smui/common を読むよう、先頭に置く
// (テーマの設定 (with) は、同じ場所から読んだモジュールにだけ効くため)
const commonStore = storeOf(join(stores[0] ?? '', '@smui/common'));
const loadPaths = [commonStore, ...stores];

/**
 * @param {string} theme src/theme から見たテーマのファイル
 * @param {readonly string[]} packages スタイルを入れる部品
 */
function compile(theme, packages) {
	const source = [
		`@use '${theme}';`,
		...packages.map((name) => `@use '${name}/style' as ${name.replace(/\W/g, '_')};`),
	].join('\n');
	return sass.compileString(source, {
		loadPaths,
		url: new URL(`file:///${webRoot.replaceAll('\\', '/')}/src/theme/entry.scss`),
		style: 'compressed',
		// SMUI 9 の Sass が使う古い書き方の警告。直すのは SMUI 側なので、変換の出力には出さない
		silenceDeprecations: ['if-function', 'import', 'global-builtin'],
		quietDeps: true,
	}).css;
}

const light = compile('smui-theme', smuiPackages);
// 部品のスタイルは色を CSS 変数で読むので、ダーク用は変数だけにする (部品のスタイルを 2 回出さない)
const dark = compile('dark/smui-theme', []);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
	output,
	`/* scripts/build-theme.js が作る。手で直さない */\n${light}\n@media (prefers-color-scheme: dark){${dark}}\n`,
);
console.log(`テーマの CSS を作りました (${smuiPackages.join('、')}): ${output}`);
