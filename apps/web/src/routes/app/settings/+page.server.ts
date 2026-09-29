// 設定の画面。全員が使う項目の下に、管理者にだけ「管理」の節、モデレーターにだけ「モデレーター」の節を出す
import { redirect, type ServerLoad } from '@sveltejs/kit';
import { loadAdminSummary } from '$lib/server/admin-summary.ts';
import { loadInviteStatus } from '$lib/server/invites.ts';
import { loadOfficialDocuments } from '$lib/server/official-documents.ts';
import { getServices } from '$lib/server/services.ts';

export const load: ServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	const services = getServices();
	// 招待コードを発行できる人 (今月の上限に達した人も含む) にだけ、招待の入口を出す
	const { issuance } = loadInviteStatus(services, locals.user, new Date());
	return {
		canInvite: issuance.kind !== 'not-allowed',
		documents: loadOfficialDocuments(services.settings),
		admin: locals.user.role === 'admin' ? loadAdminSummary(services, new Date()) : null,
		// 管理者は「管理」の節に、監査と確認の入口も持つので、ここは moderator だけに出す
		moderator: locals.user.role === 'moderator',
		// OAuth の Client ID と Secret が設定されているときだけ入口を出す (設計書 14.9、#163)
		discordLinkAvailable: services.discord.link.configured,
	};
};
