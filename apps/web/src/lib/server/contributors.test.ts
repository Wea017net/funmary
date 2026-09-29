import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { fetchContributors as FetchContributors } from './contributors.ts';

const RESPONSE = [
	{
		login: 'otoneko',
		html_url: 'https://github.com/otoneko',
		avatar_url: 'https://avatars.githubusercontent.com/u/1',
		contributions: 42,
		type: 'User',
	},
	// Bot は除く
	{
		login: 'renovate[bot]',
		html_url: 'https://github.com/apps/renovate',
		avatar_url: 'https://avatars.githubusercontent.com/u/2',
		contributions: 5,
		type: 'Bot',
	},
];

/** モジュール単位のキャッシュを、テストごとにリセットするため、毎回読み込み直す */
async function loadFetchContributors(): Promise<typeof FetchContributors> {
	vi.resetModules();
	return (await import('./contributors.ts')).fetchContributors;
}

let now: number;

beforeEach(() => {
	now = Date.UTC(2026, 8, 29);
});

describe('fetchContributors', () => {
	it('GitHub から取り、Bot を除いて返す', async () => {
		const fetchContributors = await loadFetchContributors();
		const fetchImpl = vi.fn(() =>
			Promise.resolve(new Response(JSON.stringify(RESPONSE), { status: 200 })),
		);

		const contributors = await fetchContributors(fetchImpl, () => now);

		expect(fetchImpl).toHaveBeenCalledOnce();
		expect(contributors).toEqual([
			{
				login: 'otoneko',
				url: 'https://github.com/otoneko',
				avatarUrl: 'https://avatars.githubusercontent.com/u/1',
				contributions: 42,
			},
		]);
	});

	it('しばらくは取り直さず、覚えたものを返す', async () => {
		const fetchContributors = await loadFetchContributors();
		const fetchImpl = vi.fn(() =>
			Promise.resolve(new Response(JSON.stringify(RESPONSE), { status: 200 })),
		);

		await fetchContributors(fetchImpl, () => now);
		await fetchContributors(fetchImpl, () => now + 60_000);

		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it('時間が経てば、取り直す', async () => {
		const fetchContributors = await loadFetchContributors();
		const fetchImpl = vi.fn(() =>
			Promise.resolve(new Response(JSON.stringify(RESPONSE), { status: 200 })),
		);

		await fetchContributors(fetchImpl, () => now);
		await fetchContributors(fetchImpl, () => now + 7 * 60 * 60 * 1000);

		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('取得に失敗しても、前に取れていればそれを返す', async () => {
		const fetchContributors = await loadFetchContributors();
		const ok = vi.fn(() =>
			Promise.resolve(new Response(JSON.stringify(RESPONSE), { status: 200 })),
		);
		await fetchContributors(ok, () => now);

		const failing = vi.fn(() => Promise.resolve(new Response(null, { status: 500 })));
		const contributors = await fetchContributors(failing, () => now + 7 * 60 * 60 * 1000);

		expect(contributors).toEqual([
			{
				login: 'otoneko',
				url: 'https://github.com/otoneko',
				avatarUrl: 'https://avatars.githubusercontent.com/u/1',
				contributions: 42,
			},
		]);
	});

	it('一度も取れていなければ、失敗を投げる', async () => {
		const fetchContributors = await loadFetchContributors();
		const failing = vi.fn(() => Promise.resolve(new Response(null, { status: 500 })));

		await expect(fetchContributors(failing, () => now)).rejects.toThrow();
	});
});
