// 節目の版 (v*) の名前を決める (release-tag.yml)。I/O は持たない。

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const BUMP_KINDS = /** @type {const} */ (['patch', 'minor', 'major']);

/**
 * workflow_dispatch の入力 (patch/minor/major か X.Y.Z の直接指定) から、次の v* の版を決める。
 * 直前の v* タグがなければ v0.0.0 を基準にする (最初の節目)
 * @param {string} input
 * @param {string | null} previousTag 直前の v* タグ (例: "v0.2.0")。なければ null
 * @returns {string}
 */
export function nextVersionTag(input, previousTag) {
	const direct = SEMVER.exec(input);
	if (direct) return `v${input}`;
	if (!BUMP_KINDS.includes(/** @type {never} */ (input))) {
		throw new Error(
			`version は patch/minor/major か X.Y.Z の形にしてください: ${JSON.stringify(input)}`,
		);
	}
	const base = previousTag ? SEMVER.exec(previousTag.replace(/^v/, '')) : null;
	if (previousTag && !base) {
		throw new Error(`直前のタグが X.Y.Z の形として読めません: ${JSON.stringify(previousTag)}`);
	}
	const [majorRaw, minorRaw, patchRaw] = base ? base.slice(1).map(Number) : [0, 0, 0];
	const major = majorRaw ?? 0;
	const minor = minorRaw ?? 0;
	const patch = patchRaw ?? 0;
	if (input === 'major') return `v${major + 1}.0.0`;
	if (input === 'minor') return `v${major}.${minor + 1}.0`;
	return `v${major}.${minor}.${patch + 1}`;
}
