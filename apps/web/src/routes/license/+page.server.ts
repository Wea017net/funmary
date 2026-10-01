// Funmary 自身のライセンス (BSD-3-Clause と Apache-2.0 のデュアルライセンス)。ログインしていなくても開ける (#223)
import type { ServerLoad } from '@sveltejs/kit';
import { getServices } from '$lib/server/services.ts';

export const load: ServerLoad = () => {
	return { licenses: getServices().legal?.licenses ?? null };
};
