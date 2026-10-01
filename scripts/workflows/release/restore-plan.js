// 消えたリリースの復元の計画 (restore-releases.yml、Issue #222)。判断の部分だけを持ち、I/O は restore-releases.js が行う。
// 以前の Release は、新しいものを 10 個だけ残し、古いリリースをタグと添付のファイルごと消していた。
import { releaseVersion } from './release-version.js';

/**
 * Release の実行のログから、リリースにしたコミット (環境変数 HEAD_SHA) を取り出す
 * @param {string} log
 * @returns {string | null}
 */
export function extractReleasedSha(log) {
	return /HEAD_SHA: ([0-9a-f]{40})\b/.exec(log)?.[1] ?? null;
}

/**
 * 復元するリリースを決める。Release の実行は新しい順に渡す。タグが残っているものは除き、古い順に、重複なく返す
 * @param {readonly string[]} releasedShas
 * @param {ReadonlySet<string>} existingTags
 * @returns {{ sha: string; version: string }[]}
 */
export function planRestore(releasedShas, existingTags) {
	const seen = new Set();
	/** @type {{ sha: string; version: string }[]} */
	const plan = [];
	for (const sha of [...releasedShas].reverse()) {
		if (seen.has(sha)) continue;
		seen.add(sha);
		const version = releaseVersion(sha);
		if (!existingTags.has(version)) plan.push({ sha, version });
	}
	return plan;
}
