// 使っているオープンソースのソフトウェアの一覧。ログインしていなくても開ける (#223)
import type { ServerLoad } from '@sveltejs/kit';
import { getServices } from '#lib/server/services.ts';

export const load: ServerLoad = () => {
	return { thirdPartyLicenses: getServices().legal?.thirdPartyLicenses ?? null };
};
