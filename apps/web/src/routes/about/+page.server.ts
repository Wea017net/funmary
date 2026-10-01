// リポジトリと、運営者へのリンク。ログインしていなくても開ける (#223)
import type { ServerLoad } from '@sveltejs/kit';
import { getServices } from '$lib/server/services.ts';

export const load: ServerLoad = () => {
	return { operator: getServices().operator };
};
