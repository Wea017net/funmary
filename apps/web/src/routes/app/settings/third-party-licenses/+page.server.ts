// 使っているオープンソースのソフトウェアの一覧
import { redirect, type ServerLoad } from '@sveltejs/kit';
import { getServices } from '$lib/server/services.ts';

export const load: ServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	return { thirdPartyLicenses: getServices().legal?.thirdPartyLicenses ?? null };
};
