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
 * 今回より前の、最も新しい自動リリース (build-<hash>) の版と、そのコミット。なければ null
 * @returns {{ version: string; sha: string } | null}
 */
function previousRelease() {
	const tags = run('gh', [
		'release',
		'list',
		'--limit',
		'30',
		'--json',
		'tagName,createdAt',
		'--jq',
		'sort_by(.createdAt) | reverse | .[].tagName',
	])
		.split('\n')
		.filter((tag) => /^build-[0-9a-f]{7,40}$/.test(tag) && tag !== version);
	for (const tag of tags) {
		const target = run('gh', [
			'release',
			'view',
			tag,
			'--json',
			'targetCommitish',
			'--jq',
			'.targetCommitish',
		]);
		// 手元のクローンにそのコミットがなければ (履歴が浅いなど)、差分を取れないので、次の候補を見る
		if (!/^[0-9a-f]{40}$/.test(target)) continue;
		try {
			run('git', ['cat-file', '-e', `${target}^{commit}`]);
			return { version: tag, sha: target };
		} catch {
			continue;
		}
	}
	return null;
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
