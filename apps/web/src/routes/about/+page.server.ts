// リポジトリと、運営者へのリンク。ログインしていなくても開ける (#223)
import type { ServerLoad } from '@sveltejs/kit';
import { getServices } from '$lib/server/services.ts';
import { SUPPORT_INVITES_KEY, publicInvite, readInvites } from '$lib/server/support-invites.ts';

export const load: ServerLoad = () => {
	const { operator, contactEmail, settings } = getServices();
	return {
		operator,
		contactEmail,
		supportInvite: publicInvite(readInvites(settings.get(SUPPORT_INVITES_KEY)), new Date()),
	};
};
