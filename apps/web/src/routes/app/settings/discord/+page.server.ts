// 利用者の Discord 連携の設定 (設計書 14.9、#163)。連携する、解除する、認可コードを受け取って完成させる。
import { fail, redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import { DEFAULT_CHANNEL_KINDS, type DiscordDestination } from '@funmary/db';
import { CHANNEL_KIND_OPTIONS, parseChannelKinds } from '$lib/server/channel-kind-form.ts';
import { parseDailyDigestForm } from '$lib/server/daily-digest-form.ts';
import { completeDiscordLink, openLinkState, sealLinkState } from '$lib/server/discord-link.ts';
import { getServices } from '$lib/server/services.ts';
import { SUPPORT_INVITES_KEY, publicInvite, readInvites } from '$lib/server/support-invites.ts';

const isDestination = (value: unknown): value is DiscordDestination =>
	value === 'thread' || value === 'dm';

export const load: ServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, '/login');
	const { discord, dailyDigest, settings, log } = getServices();
	const { link } = discord;

	const code = url.searchParams.get('code');
	const sealedState = url.searchParams.get('state');
	if (code && sealedState && link.oauth) {
		const state = openLinkState(link.stateBox, sealedState, new Date());
		const callback =
			!state || state.userId !== locals.user.id
				? { ok: false, message: '連携の有効期限が切れました。もう一度お試しください。' }
				: await completeDiscordLink(
						{
							oauth: link.oauth,
							bot: discord.bot,
							store: link.store,
							supportChannelId: link.supportChannelId(),
							log: log.withTag('discord-link'),
						},
						{ code, state },
						new Date(),
					);
		// 認可コードは 1 回しか使えない。URL に残したままだと、フォームの送信などで読み直すたびに
		// 同じコードを Discord に送り直してしまい、2 回目からは必ず失敗する。処理したらすぐ URL から消す
		const params = new URLSearchParams({
			linked: callback.ok ? 'ok' : 'error',
			message: callback.message,
		});
		redirect(303, `${url.pathname}?${params}`);
	}

	const linkedParam = url.searchParams.get('linked');
	const callback =
		linkedParam === null
			? null
			: { ok: linkedParam === 'ok', message: url.searchParams.get('message') ?? '' };

	const current = link.store.findByUser(locals.user.id);
	const { channels } = getServices();
	return {
		configured: link.configured,
		enabled: link.enabled(),
		linked: current ? { destination: current.destination } : null,
		digest: current ? dailyDigest.get(locals.user.id) : null,
		// 届ける通知の種類 (設計書 14.7、#163)。連携していなければ null
		kinds: current
			? [
					...(channels.discordLinkChannel(locals.user.id)?.notificationKinds ??
						DEFAULT_CHANNEL_KINDS),
				]
			: null,
		kindOptions: CHANNEL_KIND_OPTIONS,
		callback,
		supportInvite: publicInvite(readInvites(settings.get(SUPPORT_INVITES_KEY)), new Date()),
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
	/** 予定のまとめ (#207) の設定を保存する */
	digest: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		const { discord, dailyDigest } = getServices();
		if (!discord.link.store.findByUser(locals.user.id))
			return fail(400, { error: '連携していません。' });
		const parsed = parseDailyDigestForm(await request.formData(), dailyDigest.get(locals.user.id));
		if (!parsed.ok) return fail(400, { error: parsed.error });
		dailyDigest.save(locals.user.id, parsed.settings, new Date());
		return { message: '予定のまとめの設定を保存しました。' };
	},
	/** 届ける通知の種類を保存する (設計書 14.7、#163) */
	kinds: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		const { channels, discord } = getServices();
		if (!discord.link.store.findByUser(locals.user.id)) {
			return fail(400, { error: '連携していません。' });
		}
		const kinds = parseChannelKinds(await request.formData());
		if (!kinds) return fail(400, { error: '届ける通知の種類を、1 つ以上選んでください。' });
		channels.updateDiscordLinkKinds(locals.user.id, kinds);
		return { message: '届ける通知の種類を保存しました。' };
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
