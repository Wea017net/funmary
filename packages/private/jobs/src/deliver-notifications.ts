// 通知欄の通知を、利用者のチャネル (Discord の Webhook、Discord 連携) へ送る定期処理。
// 1 分ごとに、足りない送信待ちを作り、送る番のものを送る。失敗は間隔を広げて最大 5 回まで再送する。
// 再送しても直らないもの (Webhook の削除など) や、続けて失敗するものは、チャネルを止めて通知欄で知らせる
import type { JobDefinition } from './runner.ts';

export type DeliveryOutcome =
	| { readonly status: 'sent' }
	| { readonly status: 'gone'; readonly reason: string }
	| { readonly status: 'retry'; readonly afterMs: number | null; readonly reason: string }
	| { readonly status: 'rejected'; readonly reason: string };

export interface DeliveryItem {
	readonly id: number;
	/** これまでに試した回数 */
	readonly attempts: number;
	readonly channelId: number;
	readonly userId: string;
	readonly channelKind: 'discord' | 'generic' | 'discordLink';
	/** 送り先が引けるか。Discord 連携が解除されていれば false */
	readonly hasTarget: boolean;
}

export interface IntegrationNotice {
	readonly userId: string;
	readonly kind: 'integration';
	readonly title: string;
	readonly body: string;
	readonly link: string;
	readonly subjectId: null;
	readonly dedupeKey: string;
}

export interface DeliverNotificationsDeps {
	/** 送る前の下ごしらえ (Discord 連携の送り先を整え、送信待ちを作る) */
	prepare(now: Date): unknown;
	/** 今送る番の配信 */
	claim(now: Date, limit: number): readonly DeliveryItem[];
	/** 送る。失敗は例外ではなく結果で返す。例外を投げたら、再送する失敗として扱う */
	send(item: DeliveryItem): Promise<DeliveryOutcome>;
	markSent(id: number, now: Date): void;
	markRetry(id: number, plan: { attempts: number; nextAttemptAt: Date; error: string }): void;
	markFailed(id: number, now: Date, error: string): void;
	/** そのチャネルで、続けて失敗した数 */
	failureStreak(channelId: number): number;
	disableChannel(channelId: number, reason: string): void;
	/** 通知欄に「連携の不具合」を足す */
	notifyUser(notice: IntegrationNotice, now: Date): void;
}

/** 試す回数の上限 (最初の 1 回を含む) */
const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MINUTES = [1, 5, 30, 120];
/** 配信が続けてこの数だけ失敗したら、チャネルを止める */
const STOP_AFTER_FAILURES = 3;
const BATCH_SIZE = 50;
const MAX_BATCHES = 4;

/** 試した回数 (1 以上) のあとの、次の試行までの待ち時間 */
export function retryDelayMs(attempts: number): number {
	const index = Math.min(attempts, RETRY_DELAYS_MINUTES.length) - 1;
	return (RETRY_DELAYS_MINUTES[index] ?? 120) * 60 * 1000;
}

function stoppedNotice(item: DeliveryItem, now: Date, cause: string): IntegrationNotice {
	const link = item.channelKind === 'discordLink';
	return {
		userId: item.userId,
		kind: 'integration',
		title: link
			? '[連携の不具合] Discord への通知を止めました'
			: '[連携の不具合] Webhook への通知を止めました',
		body: link
			? `${cause}。Discord 連携をやり直すと、また届きます。`
			: `${cause}。URL を確かめて、有効に戻してください。`,
		link: link ? '/app/settings/discord' : '/app/settings/webhooks',
		subjectId: null,
		dedupeKey: `channel-stopped:${item.channelId}:${now.getTime()}`,
	};
}

export function createDeliverNotificationsJob(deps: DeliverNotificationsDeps): JobDefinition {
	return {
		name: 'deliver-notifications',
		schedule: '* * * * *',
		timeoutMs: 55 * 1000,
		quietWhenIdle: true,
		async run({ now, signal, log }) {
			deps.prepare(now());
			let sent = 0;
			let retrying = 0;
			let failed = 0;
			let stopped = 0;

			const stopChannel = (item: DeliveryItem, reason: string, cause: string) => {
				deps.disableChannel(item.channelId, reason);
				deps.notifyUser(stoppedNotice(item, now(), cause), now());
				stopped++;
			};
			const fail = (item: DeliveryItem, reason: string) => {
				deps.markFailed(item.id, now(), reason);
				failed++;
				if (deps.failureStreak(item.channelId) >= STOP_AFTER_FAILURES) {
					stopChannel(item, '続けて失敗しました', '通知を続けて送れませんでした');
				}
			};

			for (let batch = 0; batch < MAX_BATCHES && !signal.aborted; batch++) {
				const items = deps.claim(now(), BATCH_SIZE);
				if (items.length === 0) break;
				for (const item of items) {
					if (signal.aborted) break;
					if (!item.hasTarget) {
						deps.markFailed(item.id, now(), '送り先がありません');
						failed++;
						continue;
					}
					let outcome: DeliveryOutcome;
					try {
						outcome = await deps.send(item);
					} catch (error) {
						log.warn(`通知の送信で予期しないエラーが起きました: ${String(error)}`);
						outcome = { status: 'retry', afterMs: null, reason: '予期しないエラー' };
					}
					switch (outcome.status) {
						case 'sent':
							deps.markSent(item.id, now());
							sent++;
							break;
						case 'gone':
							deps.markFailed(item.id, now(), outcome.reason);
							failed++;
							stopChannel(item, outcome.reason, outcome.reason);
							break;
						case 'rejected':
							fail(item, outcome.reason);
							break;
						case 'retry': {
							const attempts = item.attempts + 1;
							if (attempts >= MAX_ATTEMPTS) {
								fail(item, outcome.reason);
								break;
							}
							const wait = outcome.afterMs ?? retryDelayMs(attempts);
							deps.markRetry(item.id, {
								attempts,
								nextAttemptAt: new Date(now().getTime() + wait),
								error: outcome.reason,
							});
							retrying++;
							break;
						}
					}
				}
			}

			if (sent + retrying + failed + stopped === 0) return;
			const parts = [`通知を ${sent} 件送りました`];
			if (retrying > 0) parts.push(`${retrying} 件は再送を待っています`);
			if (failed > 0) parts.push(`${failed} 件は届きませんでした`);
			if (stopped > 0) parts.push(`${stopped} 件の送り先を止めました`);
			return parts.join('。');
		},
	};
}
