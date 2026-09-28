// 管理用コマンド (funmary-admin notify) が使う、管理用の Discord への通知 (設計書 14.9)。
// VPS の update.sh が、反映の結果を deploy のチャンネルに送るために呼ぶ。
import type { Logger } from '@funmary/log';
import {
	createAdminAlerter,
	createAdminDiscordSink,
	type AdminAlertSeverity,
	type AdminChannel,
	type DiscordBot,
	type DiscordLayout,
} from '@funmary/notify';

export type AdminNotifyResult = 'sent' | 'no-destination' | 'failed';

export async function sendAdminNotification(options: {
	/** Bot。設定されていなければ null (Webhook があれば、そちらに送る) */
	readonly bot: DiscordBot | null;
	readonly layout: DiscordLayout;
	readonly webhookUrl: string | undefined;
	readonly dryRun: boolean;
	readonly log: Logger;
	readonly channel: AdminChannel;
	readonly severity: AdminAlertSeverity;
	readonly message: string;
}): Promise<AdminNotifyResult> {
	const alerter = createAdminAlerter({
		webhookUrl: options.webhookUrl,
		dryRun: options.dryRun,
		...(options.bot
			? { discord: createAdminDiscordSink({ bot: options.bot, layout: () => options.layout }) }
			: {}),
		log: options.log,
	});
	const result = await alerter.send({
		severity: options.severity,
		title: options.message,
		category: options.channel,
	});
	return result === 'sent' ? 'sent' : result === 'failed' ? 'failed' : 'no-destination';
}
