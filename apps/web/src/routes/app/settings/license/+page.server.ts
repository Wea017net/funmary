// Funmary 自身のライセンス (BSD-3-Clause と Apache-2.0 のデュアルライセンス)
import { redirect, type ServerLoad } from '@sveltejs/kit';
import { getServices } from '$lib/server/services.ts';

export const load: ServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	return { licenses: getServices().legal?.licenses ?? null };
};
