// 消えたリリースの復元の、計画とタグの付け直し (restore-releases.yml の最初のジョブ、Issue #222)。
// これまでの Release の実行のログから、各回のコミットを取り出し、タグが残っていないものにタグを付け直す。
// タグを先にすべて付けておくと、あとで各リリースのノートを作るときに、前回のリリースを正しく見つけられる。
// 環境変数: GH_TOKEN (gh が使う)、GITHUB_REPOSITORY (owner/repo)、GITHUB_OUTPUT (Actions が設定する)、
// DRY_RUN (true なら、タグを付けずに計画だけを出す)
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
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
for (const { sha, version } of plan) {
	console.log(`${version} ${sha}`);
	if (!dryRun) {
		gh(['api', `repos/${repo}/git/refs`, '-f', `ref=refs/tags/${version}`, '-f', `sha=${sha}`]);
	}
}

appendFileSync(process.env['GITHUB_OUTPUT'] ?? '/dev/null', `plan=${JSON.stringify(plan)}\n`);
