// publish-npm.yml から呼ぶ。公開する版と dist-tag を決めて、後の手順に、環境変数 (GITHUB_ENV) で渡す。
// 環境変数: VERSION_INPUT、DIST_TAG_INPUT、GITHUB_ENV。npm にある版は、npm view で調べる (まだなければ、ないものとする)
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolveNpmVersion } from './npm-version.js';

const PACKAGES = ['@funmary/client', '@funmary/mcp', 'funmary'];

/** @param {string} name */
function publishedVersions(name) {
	try {
		const raw = execFileSync('npm', ['view', name, 'versions', '--json'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		/** @type {unknown} */
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
	} catch {
		return [];
	}
}

const result = resolveNpmVersion(
	(process.env['VERSION_INPUT'] ?? '').trim(),
	(process.env['DIST_TAG_INPUT'] ?? '').trim(),
	PACKAGES.flatMap(publishedVersions),
);
console.log(
	`公開する版: ${result.version} (dist-tag: ${result.tag}${result.prerelease ? '、先行版' : ''})`,
);
const githubEnv = process.env['GITHUB_ENV'];
if (githubEnv) {
	appendFileSync(
		githubEnv,
		`VERSION=${result.version}\nNPM_TAG=${result.tag}\nPRERELEASE=${result.prerelease}\n`,
	);
}
