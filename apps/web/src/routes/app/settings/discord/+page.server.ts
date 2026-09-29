// 利用者の Discord 連携の設定 (設計書 14.9、#163)。連携する、解除する、認可コードを受け取って完成させる。
import { fail, redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import type { DiscordDestination } from '@funmary/db';
import { completeDiscordLink, openLinkState, sealLinkState } from '$lib/server/discord-link.ts';
import { getServices } from '$lib/server/services.ts';

const isDestination = (value: unknown): value is DiscordDestination =>
	value === 'thread' || value === 'dm';

export const load: ServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, '/login');
	const { discord } = getServices();
	const { link } = discord;

	const code = url.searchParams.get('code');
	const sealedState = url.searchParams.get('state');
	let callback: { ok: boolean; message: string } | null = null;
	if (code && sealedState && link.oauth) {
		const state = openLinkState(link.stateBox, sealedState, new Date());
		if (!state || state.userId !== locals.user.id) {
			callback = { ok: false, message: '連携の有効期限が切れました。もう一度お試しください。' };
		} else {
			callback = await completeDiscordLink(
				{
					oauth: link.oauth,
					bot: discord.bot,
					store: link.store,
					supportChannelId: link.supportChannelId(),
				},
				{ code, state },
				new Date(),
			);
		}
	}

	const current = link.store.findByUser(locals.user.id);
	return {
		configured: link.configured,
		enabled: link.enabled(),
		linked: current ? { destination: current.destination } : null,
		callback,
	};
};

export const actions: Actions = {
	/** Discord の認可の画面へ移る */
	link: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		const { discord } = getServices();
		const { link } = discord;
		if (!link.configured || !link.enabled() || !link.oauth) {
			return fail(400, { error: 'いまは Discord 連携を使えません。' });
		}
		const form = await request.formData();
		const destination = form.get('destination');
		if (!isDestination(destination)) return fail(400, { error: '入力が足りません。' });
		const sealed = sealLinkState(link.stateBox, {
			userId: locals.user.id,
			destination,
			startedAt: Date.now(),
		});
		redirect(303, link.oauth.authorizationUrl(sealed));
	},
	/** 連携を解除する。Discord に接続できなくても、必ず成功する (設計書 14.9) */
	unlink: ({ locals }) => {
		if (!locals.user) redirect(303, '/login');
		const { discord } = getServices();
		const { link } = discord;
		const removed = link.store.remove(locals.user.id);
		if (!removed) return fail(400, { error: '連携していません。' });
		if (discord.bot) {
			if (removed.destination === 'thread') void discord.bot.archiveThread(removed.channelId);
			if (link.oauth) void link.oauth.revoke(removed.accessToken);
		}
		return { message: 'Discord との連携を解除しました。' };
	},
};
