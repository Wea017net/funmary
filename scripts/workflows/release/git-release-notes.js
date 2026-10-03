// Git の履歴から、リリースノートを作る (publish-release.js と、消えたリリースの復元の restore-releases.js が使う)。
// 前回のリリースは、作った日時の順ではなく、main の履歴 (first-parent) で一番近い build-* のタグから探す
// (消えたリリースを復元すると、古いリリースほど作った日時が新しくなるため)。
// タグを読むので、checkout は履歴とタグをすべて取る (fetch-depth: 0)。手元に付けただけのタグも使える
import { execFileSync } from 'node:child_process';
import { buildReleaseNotes } from './release-notes.js';

/**
 * @param {string} command
 * @param {string[]} args
 */
const run = (command, args) =>
	execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/**
 * sha から main の履歴をさかのぼって、一番近い (tagMatch に合う) タグの版と、そのコミット。なければ null
 * @param {string} sha
 * @param {string} tagMatch 探すタグの形 (git describe --match)。既定は自動リリースの build-<hash>
 * @returns {{ version: string; sha: string } | null}
 */
function previousRelease(sha, tagMatch = 'build-*') {
	try {
		const tag = run('git', [
			'describe',
			'--tags',
			'--abbrev=0',
			'--first-parent',
			'--match',
			tagMatch,
			`${sha}~1`,
		]);
		return { version: tag, sha: run('git', ['rev-list', '-n', '1', tag]) };
	} catch {
		// さかのぼっても見つからない (最初のリリース) か、親のコミットがない
		return null;
	}
}

/**
 * @param {{ repo: string; version: string; sha: string; tagMatch?: string }} release
 * @returns {string}
 */
export function releaseNotesFromGit({ repo, version, sha, tagMatch = 'build-*' }) {
	const previous = previousRelease(sha, tagMatch);
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
	return buildReleaseNotes({
		repo,
		version,
		sha,
		previousVersion: previous?.version ?? null,
		previousSha: previous?.sha ?? null,
		subjects,
		changedFiles,
	});
}
