import { createLogger } from '@funmary/log';
import { createDiscordBot, type DiscordLayout } from '@funmary/notify';
import { describe, expect, it } from 'vitest';
import { sendAdminNotification } from './admin-notify.ts';

const layout: DiscordLayout = {
	category: { id: '1', managed: true },
	channels: { deploy: { id: '21', managed: true }, other: { id: '29', managed: true } },
	roles: { deploy: { id: '31', managed: true } },
};
const log = createLogger({ level: 'error', format: 'text', mode: 'production', write: () => {} });

function setup(status = 204) {
	const posts: { url: string; body: { content: string } }[] = [];
	const bot = createDiscordBot({
		token: 'dummy-bot-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
		guildId: '111',
		fetch: (url, init) => {
			posts.push({
				url,
				body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { content: string },
			});
			return Promise.resolve(new Response(null, { status }));
		},
	});
	return { bot, posts };
}

const base = { layout, webhookUrl: undefined, dryRun: false, log } as const;

describe('sendAdminNotification', () => {
	it('deploy のチャンネルに送る。失敗のときは、ロールにメンションする', async () => {
		const { bot, posts } = setup();
		await expect(
			sendAdminNotification({
				...base,
				bot,
				channel: 'deploy',
				severity: 'error',
				message: '反映に失敗',
			}),
		).resolves.toBe('sent');
		expect(posts).toHaveLength(1);
		expect(posts[0]?.url).toBe('https://discord.com/api/v10/channels/21/messages');
		expect(posts[0]?.body.content).toBe('<@&31>\n**反映に失敗**');
	});

	it('成功のお知らせには、メンションを付けない', async () => {
		const { bot, posts } = setup();
		await sendAdminNotification({
			...base,
			bot,
			channel: 'deploy',
			severity: 'info',
			message: '切り替えました',
		});
		expect(posts[0]?.body.content).toBe('**切り替えました**');
	});

	it('Bot がなく、Webhook もなければ、送り先がないことを返す', async () => {
		await expect(
			sendAdminNotification({
				...base,
				bot: null,
				channel: 'deploy',
				severity: 'info',
				message: 'x',
			}),
		).resolves.toBe('no-destination');
	});

	it('送れなかったら failed を返す', async () => {
		const { bot } = setup(500);
		await expect(
			sendAdminNotification({ ...base, bot, channel: 'deploy', severity: 'info', message: 'x' }),
		).resolves.toBe('failed');
	});
});
