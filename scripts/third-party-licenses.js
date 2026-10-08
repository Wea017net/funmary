// 本番の依存のライセンスを 1 つのテキストにまとめる。リリースに THIRD_PARTY_LICENSES.txt として添える。
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {object} LicenseEntry
 * @property {string} name
 * @property {string[]} versions
 * @property {string[]} paths
 * @property {string} license
 * @property {string} [homepage]
 */

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.[a-z]+)?$/i;

/**
 * pnpm が本番の依存として数えるパッケージの、名前、版、ライセンス、ライセンス文を並べる
 * @param {string} cwd
 * @returns {string}
 */
export function generateThirdPartyLicenses(cwd) {
	const output = execSync('pnpm -r licenses list --prod --json', {
		cwd,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	});
	/** @type {unknown} */
	const parsed = JSON.parse(output);
	const byLicense = /** @type {Record<string, LicenseEntry[]>} */ (parsed);
	const entries = Object.values(byLicense)
		.flat()
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

	const sections = entries.map((entry) => {
		const lines = [`${entry.name} ${entry.versions.join(', ')}`, `ライセンス: ${entry.license}`];
		if (entry.homepage) lines.push(`ホームページ: ${entry.homepage}`);
		const dir = entry.paths[0];
		if (dir && existsSync(dir)) {
			for (const file of readdirSync(dir).filter((name) => LICENSE_FILE.test(name))) {
				lines.push('', readFileSync(join(dir, file), 'utf8').trim());
			}
		}
		return lines.join('\n');
	});

	return [
		'Funmary が使っているオープンソースのソフトウェアのライセンスです。',
		'',
		sections.join('\n\n----------------------------------------\n\n'),
		'',
	].join('\n');
}
