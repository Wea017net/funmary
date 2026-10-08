// GitHub の貢献者の一覧。認証なしの GitHub API はレート制限が厳しいので、しばらく覚えておいて使い回す。
import * as v from 'valibot';
import { REPOSITORY_URL } from '#lib/repository.ts';

/** リポジトリの owner/repo。移管 (#114) で REPOSITORY_URL が変わっても、ここは書き換えなくてよい */
const REPO_PATH = new URL(REPOSITORY_URL).pathname.replace(/^\//, '');
const CONTRIBUTORS_URL = `https://api.github.com/repos/${REPO_PATH}/contributors?per_page=100`;
/** 覚えておく時間 */
const CACHE_MS = 6 * 60 * 60 * 1000;
/** 取得に失敗したあと、問い合わせを控える時間。画面はだれでも開けるので、開かれるたびに問い合わせない */
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

export interface Contributor {
	login: string;
	url: string;
	avatarUrl: string;
	contributions: number;
}

const responseSchema = v.array(
	v.object({
		login: v.string(),
		html_url: v.string(),
		avatar_url: v.string(),
		contributions: v.number(),
		type: v.string(),
	}),
);

let cache: { at: number; contributors: Contributor[] } | undefined;
let lastFailure: { at: number; error: unknown } | undefined;

function parse(body: unknown): Contributor[] {
	const parsed = v.safeParse(responseSchema, body);
	if (!parsed.success) return [];
	return parsed.output
		.filter((entry) => entry.type === 'User')
		.map((entry) => ({
			login: entry.login,
			url: entry.html_url,
			avatarUrl: entry.avatar_url,
			contributions: entry.contributions,
		}));
}

/**
 * GitHub の貢献者を取得する。前に取れていれば、CACHE_MS の間はそれを返す。
 * 取得に失敗しても、前に取れていればそれを返す (GitHub 側の一時的な不調で画面を壊さないため)。
 * 失敗したあと RETRY_AFTER_FAILURE_MS の間は、問い合わせずに同じ結果にする
 */
export async function fetchContributors(
	fetchImpl: typeof fetch = fetch,
	now: () => number = Date.now,
): Promise<Contributor[]> {
	if (cache && now() - cache.at < CACHE_MS) return cache.contributors;
	if (lastFailure && now() - lastFailure.at < RETRY_AFTER_FAILURE_MS) {
		if (cache) return cache.contributors;
		throw lastFailure.error;
	}
	try {
		const response = await fetchImpl(CONTRIBUTORS_URL, {
			headers: { Accept: 'application/vnd.github+json' },
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) throw new Error(`GitHub の貢献者を取得できませんでした (${response.status})`);
		const contributors = parse(await response.json());
		cache = { at: now(), contributors };
		lastFailure = undefined;
		return contributors;
	} catch (error) {
		lastFailure = { at: now(), error };
		if (cache) return cache.contributors;
		throw error;
	}
}
