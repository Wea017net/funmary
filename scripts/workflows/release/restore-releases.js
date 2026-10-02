// 消えたリリースの復元の、計画とリリースの項目の作り直し (restore-releases.yml の最初のジョブ、Issue #222)。
// これまでの Release の実行のログから、各回のコミットを取り出し、タグが残っていないものについて、
// リリースノート付きの項目を古い順に作る (添付のファイルは、次のジョブが各コミットをビルドし直して置く)。
// タグは、Git の参照の API ではなく、リリースの API で作る。GITHUB_TOKEN で参照の API を使うと、ワークフローの
// ファイルを含むコミットには workflows の権限が要り、付けられないため (ふだんの Release と同じ作り方)。
// ノートの「前回のリリース」は、先に手元にだけ付けたタグから探す。
// 環境変数: GH_TOKEN (gh が使う)、GITHUB_REPOSITORY (owner/repo)、GITHUB_OUTPUT (Actions が設定する)、
// DRY_RUN (true なら、タグを付けずに計画だけを出す)
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseNotesFromGit } from './git-release-notes.js';
import { extractReleasedSha, planRestore } from './restore-plan.js';

const repo = process.env['GITHUB_REPOSITORY'] ?? '';
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
	throw new Error('GITHUB_REPOSITORY が owner/repo の形ではありません');
}
const dryRun = process.env['DRY_RUN'] === 'true';

/** @param {string[]} args */
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/** @type {unknown} */
const runPages = JSON.parse(
	gh([
		'api',
		'--paginate',
		'--slurp',
		`repos/${repo}/actions/workflows/release.yml/runs?status=success&per_page=100`,
	]),
);
const runIds = /** @type {{ workflow_runs: { id: number }[] }[]} */ (runPages).flatMap((page) =>
	page.workflow_runs.map((run) => run.id),
);

/** @type {string[]} */
const releasedShas = [];
for (const id of runIds) {
	const sha = extractReleasedSha(gh(['run', 'view', String(id), '--repo', repo, '--log']));
	if (sha) releasedShas.push(sha);
	else console.warn(`Release の実行 ${id} のログから、コミットを取り出せませんでした`);
}

/** @type {unknown} */
const tagPages = JSON.parse(
	gh(['api', '--paginate', '--slurp', `repos/${repo}/tags?per_page=100`]),
);
const existingTags = new Set(
	/** @type {{ name: string }[][]} */ (tagPages).flat().map((tag) => tag.name),
);

const plan = planRestore(releasedShas, existingTags);
console.log(
	`Release の実行 ${runIds.length} 回、リリースにしたコミット ${new Set(releasedShas).size} 個のうち、${plan.length} 個を復元します`,
);
for (const { sha, version } of plan) console.log(`${version} ${sha}`);

if (!dryRun) {
	// 手元にだけタグを付ける (push しない)。各リリースのノートで、前回のリリースを正しく見つけるため
	for (const { sha, version } of plan) {
		execFileSync('git', ['tag', version, sha]);
	}
	const notesDir = mkdtempSync(join(tmpdir(), 'restore-notes-'));
	for (const { sha, version } of plan) {
		const notesFile = join(notesDir, `${version}.md`);
		writeFileSync(notesFile, releaseNotesFromGit({ repo, version, sha }));
		// ふだんの Release と同じく、正式でない版 (prerelease) にし、「最新」の印を付けない
		gh([
			'release',
			'create',
			version,
			'--repo',
			repo,
			'--target',
			sha,
			'--title',
			version,
			'--notes-file',
			notesFile,
			'--prerelease',
			'--latest=false',
		]);
		console.log(`${version} の項目を作りました`);
	}
}

appendFileSync(process.env['GITHUB_OUTPUT'] ?? '/dev/null', `plan=${JSON.stringify(plan)}\n`);
