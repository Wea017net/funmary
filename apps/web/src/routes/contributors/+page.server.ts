// コードを書いてくれた人たち (GitHub の貢献者)。ログインしていなくても開ける (#223)
import type { ServerLoad } from '@sveltejs/kit';
import { fetchContributors } from '$lib/server/contributors.ts';

export const load: ServerLoad = async () => {
	try {
		return { contributors: await fetchContributors(), error: null };
	} catch {
		return { contributors: [], error: 'GitHub から取得できませんでした。あとで試してください。' };
	}
};
