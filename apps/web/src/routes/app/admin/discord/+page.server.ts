// 管理用の Discord の Bot の設定 (設計書 14.9)。チャンネルとロールを、Bot が作ったものを使うか、既存のものに置き換えるかを決める。
// Discord に接続するのは、管理者がこの画面で押したときだけ。トークンは画面にも応答にも出さない。
import { fail, type Actions, type ServerLoad } from '@sveltejs/kit';
import { ADMIN_CHANNELS, DiscordApiError, ensureLayout, type AdminChannel } from '@funmary/notify';
import { requireAdmin } from '$lib/server/admin.ts';
import { replaceEntry, toDiscordView, useBot } from '$lib/server/discord-admin.ts';
import { getServices } from '$lib/server/services.ts';

const NO_BOT =
	'Bot が設定されていません。環境変数 DISCORD_BOT_TOKEN と DISCORD_GUILD_ID を書いて、再起動してください。';

/** Discord の失敗を、画面に出せる文にする。秘密の値は含まれない */
const describeError = (error: unknown) =>
	error instanceof DiscordApiError
		? error.message
		: 'Discord に接続できませんでした。時間をおいて、もう一度お試しください。';

export const load: ServerLoad = ({ locals }) => {
	requireAdmin(locals);
	const { discord } = getServices();
	return { view: toDiscordView(discord.bot, discord.layout()) };
};

export const actions: Actions = {
	/** 足りないチャンネルとロールを作る。何度押しても同じ結果になる */
	ensure: async ({ locals }) => {
		requireAdmin(locals);
		const { discord } = getServices();
		if (!discord.bot) return fail(400, { error: NO_BOT });
		try {
			const { layout, actions: done } = await ensureLayout(discord.bot, discord.layout());
			discord.saveLayout(layout);
			return {
				message:
					done.length === 0
						? 'チャンネルとロールは、すべてそろっています。'
						: `整えました: ${done.join('、')}`,
			};
		} catch (error) {
			return fail(502, { error: describeError(error) });
		}
	},
	/** チャンネルかロールを、管理者が指定した ID のものに置き換える */
	replace: async ({ request, locals }) => {
		requireAdmin(locals);
		const { discord } = getServices();
		if (!discord.bot) return fail(400, { error: NO_BOT });
		const form = await request.formData();
		const kind = form.get('kind') === 'role' ? 'role' : 'channel';
		const name = form.get('name');
		const id = form.get('id');
		if (typeof name !== 'string' || typeof id !== 'string') {
			return fail(400, { error: '入力が足りません。' });
		}
		try {
			const result = await replaceEntry(discord.bot, discord.layout(), kind, name, id);
			if (!result.ok) return fail(400, { error: result.error });
			discord.saveLayout(result.layout);
			return { message: `${name} を、指定した ID のものに置き換えました。` };
		} catch (error) {
			return fail(502, { error: describeError(error) });
		}
	},
	/** 置き換えを取り消して、Bot に任せる。次に整えるときに、Bot が探して使うか、作る */
	useBot: async ({ request, locals }) => {
		requireAdmin(locals);
		const { discord } = getServices();
		const form = await request.formData();
		const kind = form.get('kind') === 'role' ? 'role' : 'channel';
		const name = form.get('name');
		if (typeof name !== 'string') return fail(400, { error: '入力が足りません。' });
		discord.saveLayout(useBot(discord.layout(), kind, name));
		return {
			message: `${name} を Bot に任せます。「チャンネルとロールを整える」を押してください。`,
		};
	},
	/** チャンネルに、テストのメッセージを送る */
	test: async ({ request, locals }) => {
		requireAdmin(locals);
		const { discord } = getServices();
		if (!discord.bot) return fail(400, { error: NO_BOT });
		const name = (await request.formData()).get('name');
		const channel = ADMIN_CHANNELS.find((candidate: AdminChannel) => candidate === name);
		const entry = channel ? discord.layout().channels[channel] : undefined;
		if (!channel || !entry) {
			return fail(400, { error: 'そのチャンネルは、まだ決まっていません。先に整えてください。' });
		}
		try {
			await discord.bot.postMessage(entry.id, 'Funmary からのテストです。');
			return { message: `#${channel} にテストのメッセージを送りました。` };
		} catch (error) {
			return fail(502, { error: describeError(error) });
		}
	},
};
