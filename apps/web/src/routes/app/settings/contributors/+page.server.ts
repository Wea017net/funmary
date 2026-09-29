// コードを書いてくれた人たち (GitHub の貢献者)
import { redirect, type ServerLoad } from '@sveltejs/kit';
import { fetchContributors } from '$lib/server/contributors.ts';

export const load: ServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	try {
		return { contributors: await fetchContributors(), error: null };
	} catch {
		return { contributors: [], error: 'GitHub から取得できませんでした。あとで試してください。' };
	}
};
