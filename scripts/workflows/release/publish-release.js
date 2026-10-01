// リリースの tar.gz を作り、GitHub Releases に置く (release.yml)。
// 環境変数: HEAD_SHA (リリースにするコミット)、GH_TOKEN (gh が使う)、GITHUB_REPOSITORY (owner/repo)
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { buildReleaseNotes } from './release-notes.js';
import { releaseVersion } from './release-version.js';

const sha = process.env['HEAD_SHA'] ?? '';
const version = releaseVersion(sha);
const repo = process.env['GITHUB_REPOSITORY'] ?? '';
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
	throw new Error(`GITHUB_REPOSITORY を owner/repo の形で渡してください: ${JSON.stringify(repo)}`);
}

/**
 * @param {string} command
 * @param {string[]} args
 */
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim();

/**
 * 今回のコミットから main の履歴 (first-parent) をさかのぼって、一番近い自動リリース (build-<hash>) のタグの版と、そのコミット。
 * なければ null。作った日時の順では選ばない (消えたリリースを復元すると、古いリリースほど作った日時が新しくなるため)。
 * タグを読むので、checkout は履歴とタグをすべて取る (fetch-depth: 0)
 * @returns {{ version: string; sha: string } | null}
 */
function previousRelease() {
	try {
		const tag = run('git', [
			'describe',
			'--tags',
			'--abbrev=0',
			'--first-parent',
			'--match',
			'build-*',
			`${sha}~1`,
		]);
		return { version: tag, sha: run('git', ['rev-list', '-n', '1', tag]) };
	} catch {
		// さかのぼっても見つからない (最初のリリース) か、親のコミットがない
		return null;
	}
}

const previous = previousRelease();
const subjects = (
	previous
		? run('git', ['log', '--first-parent', '--format=%s', `${previous.sha}..${sha}`])
		: run('git', ['log', '--first-parent', '--format=%s', '--max-count=20', sha])
)
	.split('\n')
	.filter(Boolean);
const changedFiles = previous
	? run('git', ['diff', '--name-only', previous.sha, sha]).split('\n').filter(Boolean)
	: [];

const notes = buildReleaseNotes({
	repo,
	version,
	sha,
	previousVersion: previous?.version ?? null,
	previousSha: previous?.sha ?? null,
	subjects,
	changedFiles,
});

// pnpm は Linux の Actions で動かすので、シェルを通さずに呼べる
execFileSync('pnpm', ['package-release', version], { stdio: 'inherit' });

writeFileSync('release/notes.md', notes);
console.log(`リリースノート:\n${notes}`);

// 同じ版を作り直したときは、置き換える
try {
	execFileSync('gh', ['release', 'delete', version, '--cleanup-tag', '--yes'], { stdio: 'ignore' });
} catch {
	// まだなければ、消すものがないだけ
}
execFileSync(
	'gh',
	[
		'release',
		'create',
		version,
		'--target',
		sha,
		'--title',
		version,
		'--notes-file',
		'release/notes.md',
		'--prerelease',
		`release/funmary-${version}.tar.gz`,
		`release/funmary-${version}.tar.gz.sha256`,
		'release/build-hash.txt',
		'release/THIRD_PARTY_LICENSES.txt',
	],
	{ stdio: 'inherit' },
);
console.log(`${version} を GitHub Releases に置きました`);
