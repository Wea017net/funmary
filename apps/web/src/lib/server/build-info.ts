// 動いているアプリの版の情報。リリースの tar.gz に同梱した build-info.json を、起動時に 1 回だけ読む。
// ビルドに埋め込まないのは、ビルド結果の hash で「変化なし」を見分ける仕組み (update.sh) を壊さないため。
// そのため、ビルド結果が同じで再起動せずに切り替えたときは、前の版の情報が出る (中身は同じ)。
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as v from 'valibot';

const FILE_NAME = 'build-info.json';
/** 上へたどる階層の数。build/server/chunks から、リリースのルートまで届けばよい */
const MAX_DEPTH = 6;

const schema = v.object({
	version: v.pipe(v.string(), v.regex(/^(build-[0-9a-f]{7,40}|v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?)$/)),
	commit: v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/)),
	buildNumber: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1))),
	builtAt: v.pipe(v.string(), v.isoTimestamp()),
});

export type BuildInfo = v.InferOutput<typeof schema>;

/** startDir から上へたどって build-info.json を読む。なければ (手元の開発)、または形が違えば null */
export function findBuildInfo(startDir: string): BuildInfo | null {
	let current = startDir;
	for (let depth = 0; depth <= MAX_DEPTH; depth++) {
		const path = join(current, FILE_NAME);
		if (existsSync(path)) {
			try {
				const parsed = v.safeParse(schema, JSON.parse(readFileSync(path, 'utf8')));
				return parsed.success ? parsed.output : null;
			} catch {
				return null;
			}
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return null;
}
