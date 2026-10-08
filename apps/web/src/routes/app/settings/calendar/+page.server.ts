// カレンダーの購読の設定 (設計書 13 章)。購読の URL を発行、再発行、無効にする。
// URL のトークンは DB にハッシュだけを保存するので、URL と QR コードは発行の直後に 1 回だけ出す。
import { redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import { qrCode, subscriptionLinks } from '#lib/server/calendar-subscription.ts';
import { formatJstDateTime } from '#lib/server/invites.ts';
import { getServices } from '#lib/server/services.ts';

export const load: ServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	const current = getServices().feedTokens.current(locals.user.id, 'calendar');
	return {
		subscription: current && {
			createdAt: formatJstDateTime(current.createdAt),
			lastUsedAt: current.lastUsedAt && formatJstDateTime(current.lastUsedAt),
		},
	};
};

export const actions: Actions = {
	issue: ({ locals }) => {
		if (!locals.user) redirect(303, '/login');
		const services = getServices();
		const token = services.feedTokens.issue(locals.user.id, 'calendar', new Date());
		const links = subscriptionLinks(services.origin, token);
		return { issued: { ...links, qr: qrCode(links.url) } };
	},
	revoke: ({ locals }) => {
		if (!locals.user) redirect(303, '/login');
		getServices().feedTokens.revoke(locals.user.id, 'calendar', new Date());
		return {
			message: '購読の URL を無効にしました。カレンダーアプリの予定は、もう更新されません。',
		};
	},
};
