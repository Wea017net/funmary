// 管理用の Bot を、Discord のメンバー一覧で「オンライン」に見せる。
// 見た目のためだけに Gateway へつなぎ、状態を送る。イベントは何も受け取らない (intents は 0。特権の設定は要らない)。
// つなぎ方、ハートビート、再接続、再開、IDENTIFY の間隔の管理は、公式の @discordjs/ws に任せる。
// メッセージの送信や、チャンネルとロールの操作は REST で行うので、切れていても通知は届く。
import { ActivityType, PresenceUpdateStatus } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import { WebSocketManager, WebSocketShardEvents } from '@discordjs/ws';
import type { Logger } from '@funmary/log';

export interface DiscordPresence {
	start(): void;
	stop(): void;
}

/** WebSocketManager のうち、使う部分。差し替えて確かめられるようにする */
export type PresenceManager = Pick<WebSocketManager, 'connect' | 'destroy' | 'on'>;

export interface DiscordPresenceOptions {
	readonly token: string;
	readonly log: Logger;
	/** 「〜を視聴中」のように出す文。省くと Funmary */
	readonly activity?: string;
	/** 差し替え用 (テスト)。省くと、token から WebSocketManager を作る */
	readonly createManager?: () => PresenceManager;
}

export function createDiscordPresence(options: DiscordPresenceOptions): DiscordPresence {
	const log = options.log.withTag('discord-presence');
	let manager: PresenceManager | null = null;

	const create = (): PresenceManager =>
		new WebSocketManager({
			token: options.token,
			intents: 0,
			rest: new REST({ version: '10' }).setToken(options.token),
			initialPresence: {
				status: PresenceUpdateStatus.Online,
				afk: false,
				since: null,
				activities: [{ name: options.activity ?? 'Funmary', type: ActivityType.Watching }],
			},
		});

	return {
		start() {
			if (manager) return;
			const current = (options.createManager ?? create)();
			manager = current;
			current.on(WebSocketShardEvents.Ready, () => {
				log.info('Gateway につながりました (オンライン表示)');
			});
			current.on(WebSocketShardEvents.Closed, (code: number) => {
				log.warn(`Gateway が閉じました (終了コード ${code})`);
			});
			current.on(WebSocketShardEvents.Error, (error: Error) => {
				log.warn(`Gateway でエラーが起きました: ${error.message}`);
			});
			// トークンの誤りなど、つなげなかったときは、例外にせず、ログに残す (アプリの起動は止めない)
			current.connect().catch((error: unknown) => {
				log.error(
					`Gateway につなげませんでした: ${error instanceof Error ? error.message : String(error)}`,
				);
				if (manager === current) manager = null;
			});
		},
		stop() {
			const current = manager;
			manager = null;
			current?.destroy({ code: 1000 }) as unknown;
		},
	};
}
