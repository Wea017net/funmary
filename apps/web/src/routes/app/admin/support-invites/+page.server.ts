// Discord のサポートサーバーの招待リンク (#214)。Bot で発行するか、自分で作った URL を登録し、公開と取り消しを選ぶ
import { fail, type Actions, type ServerLoad } from '@sveltejs/kit';
import { jstDateTime } from '@funmary/core';
import { CHANNEL_TYPES, DiscordApiError, type DiscordBot } from '@funmary/notify';
import { requireAdmin } from '#lib/server/admin.ts';
import { getServices } from '#lib/server/services.ts';
import {
	SUPPORT_INVITES_KEY,
	addInvite,
	inviteUrl,
	isActive,
	parseIssueForm,
	parseManualForm,
	readInvites,
	updateInvite,
	type SupportInvite,
} from '#lib/server/support-invites.ts';

const formatTime = (iso: string) => {
	const { date, time } = jstDateTime(new Date(iso));
	return `${date} ${time}`;
};

/** 招待に使えるテキストのチャンネルと、付けられるロール (@everyone を除く) */
async function discordChoices(bot: DiscordBot) {
	const [channels, roles] = await Promise.all([bot.listChannels(), bot.listRoles()]);
	return {
		channels: channels
			.filter((channel) => channel.type === CHANNEL_TYPES.text)
			.map(({ id, name }) => ({ id, name })),
		roles: roles.filter((role) => role.id !== bot.guildId),
	};
}

const readList = () => readInvites(getServices().settings.get(SUPPORT_INVITES_KEY));
const saveList = (list: SupportInvite[]) =>
	getServices().settings.set(SUPPORT_INVITES_KEY, list, new Date());

export const load: ServerLoad = async ({ locals }) => {
	requireAdmin(locals);
	const { discord } = getServices();
	const now = new Date();
	let choices: Awaited<ReturnType<typeof discordChoices>> | null = null;
	let discordError: string | null = null;
	if (discord.bot) {
		try {
			choices = await discordChoices(discord.bot);
		} catch (error) {
			discordError =
				error instanceof DiscordApiError
					? error.message
					: 'Discord からチャンネルとロールを読めませんでした。';
		}
	}
	return {
		botConfigured: discord.bot !== null,
		discordError,
		channels: choices?.channels ?? [],
		roles: choices?.roles ?? [],
		invites: readList().map((invite) => ({
			id: invite.id,
			url: inviteUrl(invite.code),
			source: invite.source,
			public: invite.public,
			roles: invite.roles.map((role) => role.name),
			note: invite.note,
			maxUses: invite.maxUses,
			createdAt: formatTime(invite.createdAt),
			expiresAt: invite.expiresAt ? formatTime(invite.expiresAt) : null,
			state: invite.revokedAt ? 'revoked' : isActive(invite, now) ? 'active' : 'expired',
		})),
	};
};

export const actions: Actions = {
	issue: async ({ request, locals }) => {
		requireAdmin(locals);
		const { discord, alertAdmin } = getServices();
		if (!discord.bot) return fail(400, { error: 'Discord の Bot が設定されていません。' });
		const parsed = parseIssueForm(await request.formData(), await discordChoices(discord.bot));
		if (!parsed.ok) return fail(400, { error: parsed.error });
		const input = parsed.value;
		let created: { code: string; expiresAt: Date | null };
		try {
			created = await discord.bot.createInvite(input.channelId, {
				maxAgeSeconds: input.maxAgeSeconds,
				maxUses: input.maxUses,
				roleIds: input.roles.map((role) => role.id),
			});
		} catch (error) {
			if (error instanceof DiscordApiError) {
				return fail(502, {
					error:
						input.roles.length > 0 && (error.status === 403 || error.status === 400)
							? 'Discord が招待の発行を断りました。ロールを付けるには、Bot に「ロールの管理」の権限が要り、Bot より上のロールは付けられません。'
							: `Discord が招待の発行を断りました (${error.status})。`,
				});
			}
			throw error;
		}
		saveList(
			addInvite(
				readList(),
				{
					code: created.code,
					source: 'bot',
					public: input.public,
					channelId: input.channelId,
					roles: input.roles,
					note: input.note,
					maxUses: input.maxUses,
					expiresAt: created.expiresAt?.toISOString() ?? null,
				},
				new Date(),
			),
		);
		await alertAdmin({
			severity: 'info',
			title: 'サポートサーバーの招待を発行しました',
			category: 'users',
			key: `support-invite:${created.code}`,
		});
		return { message: `招待を発行しました: ${inviteUrl(created.code)}` };
	},
	register: async ({ request, locals }) => {
		requireAdmin(locals);
		const parsed = parseManualForm(await request.formData());
		if (!parsed.ok) return fail(400, { error: parsed.error });
		const list = readList();
		if (list.some((invite) => invite.code === parsed.value.code && invite.revokedAt === null)) {
			return fail(400, { error: 'この招待は、すでに登録してあります。' });
		}
		saveList(
			addInvite(
				list,
				{
					code: parsed.value.code,
					source: 'manual',
					public: parsed.value.public,
					channelId: null,
					roles: [],
					note: parsed.value.note,
					maxUses: 0,
					expiresAt: null,
				},
				new Date(),
			),
		);
		return { message: '招待を登録しました。' };
	},
	setPublic: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const id = form.get('id');
		const list = readList();
		const target = list.find((invite) => invite.id === id);
		if (!target || target.revokedAt) return fail(404, { error: '招待が見つかりません。' });
		const value = form.get('public') === 'true';
		saveList(updateInvite(list, target.id, { public: value }));
		return { message: value ? '招待を公開にしました。' : '招待を非公開にしました。' };
	},
	revoke: async ({ request, locals }) => {
		requireAdmin(locals);
		const id = (await request.formData()).get('id');
		const list = readList();
		const target = list.find((invite) => invite.id === id);
		if (!target || target.revokedAt) return fail(404, { error: '招待が見つかりません。' });
		const { discord } = getServices();
		// Bot で発行したものは、Discord からも消す。自分で作ったものは、ここでは記録を取り消すだけ
		if (target.source === 'bot') {
			if (!discord.bot) return fail(400, { error: 'Discord の Bot が設定されていません。' });
			try {
				await discord.bot.deleteInvite(target.code);
			} catch (error) {
				if (error instanceof DiscordApiError) {
					return fail(502, {
						error: `Discord で招待を消せませんでした (${error.status})。`,
					});
				}
				throw error;
			}
		}
		saveList(updateInvite(list, target.id, { revokedAt: new Date().toISOString() }));
		return {
			message:
				target.source === 'bot'
					? '招待を取り消しました (Discord からも消しました)。'
					: '招待を取り消しました。Discord の招待そのものは、Discord の画面で消してください。',
		};
	},
};
