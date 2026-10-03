// 利用規約。ログインしていなくても開ける (/about、/license と同じ扱い)
import type { ServerLoad } from '@sveltejs/kit';
import { getServices } from '$lib/server/services.ts';

export const load: ServerLoad = () => {
	const { operator, contactEmail } = getServices();
	return { operator, contactEmail };
};
