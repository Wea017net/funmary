// 管理用の通知を、Bot でチャンネルに送る部品。通知の種類からチャンネルを選び、必要なときだけロールにメンションする。
import type { AdminAlertSeverity } from './admin-alert.ts';
import type { DiscordBot } from './discord-bot.ts';
import type { AdminChannel, AdminRole, DiscordLayout } from './discord-layout.ts';

/** 通知の種類が決まっていないときの種類。error は errors、それ以外は sources */
export function defaultChannel(severity: AdminAlertSeverity): AdminChannel {
	return severity === 'error' ? 'errors' : 'sources';
}

/**
 * メンションするロール。deploy は失敗と警告のとき、errors は error のときだけ。
 * subjects は、曜日と時限の確認待ちなど、モデレーターに見てほしい警告のときに鳴らす
 */
export function rolesToMention(channel: AdminChannel, severity: AdminAlertSeverity): AdminRole[] {
	if (channel === 'errors' && severity === 'error') return ['errors'];
	if (channel === 'deploy' && severity !== 'info') return ['deploy'];
	if (channel === 'subjects' && severity !== 'info') return ['subjects'];
	return [];
}

export interface AdminDiscordSink {
	/** 送れたら true。チャンネルが決まっていないときや、送れなかったときは false */
	post(channel: AdminChannel, severity: AdminAlertSeverity, content: string): Promise<boolean>;
}

export function createAdminDiscordSink(options: {
	readonly bot: DiscordBot;
	/** 送るたびに、いまの配置を取る (管理画面で置き換えたものがすぐ効くように) */
	readonly layout: () => DiscordLayout;
}): AdminDiscordSink {
	return {
		async post(channel, severity, content) {
			const layout = options.layout();
			const target = layout.channels[channel] ?? layout.channels.other;
			if (!target) return false;
			const roleIds = rolesToMention(channel, severity).flatMap((role) => {
				const entry = layout.roles[role];
				return entry ? [entry.id] : [];
			});
			const mention = roleIds.map((id) => `<@&${id}>`).join(' ');
			try {
				await options.bot.postMessage(
					target.id,
					mention ? `${mention}\n${content}` : content,
					roleIds,
				);
				return true;
			} catch {
				return false;
			}
		},
	};
}
