// npm に公開する版と dist-tag を決める (publish-npm.yml)。I/O は持たない。

const RELEASE = /^(\d+)\.(\d+)\.(\d+)$/;
const PRERELEASE = /^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/;
const BUMP_KINDS = /** @type {const} */ (['patch', 'minor', 'major']);

/**
 * 公開された版の、X.Y.Z の部分 (先行版の -beta.0 や、確保しただけの -reserved は、落とす) のうち、いちばん新しいもの。
 * なければ 0.0.0
 * @param {readonly string[]} published
 * @returns {[number, number, number]}
 */
function newestCore(published) {
	/** @type {[number, number, number]} */
	let newest = [0, 0, 0];
	for (const version of published) {
		const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
		if (!match) continue;
		const core = /** @type {[number, number, number]} */ (match.slice(1).map(Number));
		if (
			core[0] > newest[0] ||
			(core[0] === newest[0] &&
				(core[1] > newest[1] || (core[1] === newest[1] && core[2] > newest[2])))
		) {
			newest = core;
		}
	}
	return newest;
}

/**
 * workflow_dispatch の入力 (patch/minor/major、X.Y.Z、先行版) から、公開する版と dist-tag を決める。
 * patch/minor/major は、npm に公開されている版のうち、いちばん新しいものから上げる
 * @param {string} input
 * @param {string} distTagInput 空なら、先行版は先行版の名前 (beta など)、通常の版は latest
 * @param {readonly string[]} published 3 つのパッケージの、npm にある版
 * @returns {{ version: string; tag: string; prerelease: boolean }}
 */
export function resolveNpmVersion(input, distTagInput, published) {
	let version = input;
	if (BUMP_KINDS.includes(/** @type {never} */ (input))) {
		const [major, minor, patch] = newestCore(published);
		version =
			input === 'major'
				? `${major + 1}.0.0`
				: input === 'minor'
					? `${major}.${minor + 1}.0`
					: `${major}.${minor}.${patch + 1}`;
	} else if (!RELEASE.test(input) && !PRERELEASE.test(input)) {
		throw new Error(
			`version は patch/minor/major か、X.Y.Z (1.0.0-beta.0 のような先行版も可) の形にしてください: ${JSON.stringify(input)}`,
		);
	}
	const preName = version.includes('-') ? (version.split('-')[1] ?? '').split('.')[0] : '';
	const tag = distTagInput || preName || 'latest';
	return { version, tag, prerelease: tag !== 'latest' };
}
