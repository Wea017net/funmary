// 利用者への通知を Discord に送る部品 (設計書 14.3)。送り先は、利用者が登録した Webhook と、Discord 連携の Bot の 2 つ。
// 送った結果を「送れた」「届かない」「再送する」「再送しても直らない」に分け、いつ再送するかは呼び出し側 (@funmary/jobs) が決める。
// 失敗の理由には、Webhook の URL (秘密) を含めない
import type { ReadableStreamReadResult } from 'node:stream/web';
import { DiscordApiError, type DiscordBot, type DiscordEmbed } from './discord-bot.ts';

export interface DeliveryMessage {
	readonly kind: string;
	readonly title: string;
	readonly body: string | null;
	/** 押したときに開く、絶対の URL */
	readonly url: string | null;
	readonly createdAt: Date;
}

export type SendOutcome =
	| { readonly status: 'sent' }
	/** Webhook や送り先が消えている。再送しても届かないので、チャネルを止める */
	| { readonly status: 'gone'; readonly reason: string }
	/** afterMs は相手に指定された待ち時間。null なら、こちらで間隔を決める */
	| { readonly status: 'retry'; readonly afterMs: number | null; readonly reason: string }
	/** 受け付けられなかった。再送しても直らない */
	| { readonly status: 'rejected'; readonly reason: string };

const TIMEOUT_MS = 15_000;
const MAX_TITLE = 256;
const MAX_DESCRIPTION = 4096;

const WEBHOOK_PATTERN = /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;

/** Discord の Webhook の URL か (これ以外には送らない) */
export function isDiscordWebhookUrl(url: string): boolean {
	return WEBHOOK_PATTERN.test(url);
}

/** 画面に出す形。トークンの部分を伏せる */
export function maskWebhookUrl(url: string): string {
	const match = /^(https:\/\/[^/]+\/api\/webhooks\/\d+\/)/.exec(url);
	return match ? `${match[1]}…` : '…';
}

/** 休講は赤、補講は緑、教室変更は黄 (設計書 14.3)。ほかは灰色 */
const COLORS: Readonly<Record<string, number>> = {
	cancellation: 0xe5484d,
	makeup: 0x30a46c,
	roomChange: 0xf5c518,
	integration: 0xf76b15,
};
const DEFAULT_COLOR = 0x8b8d98;

const clip = (text: string, max: number) =>
	text.length > max ? `${text.slice(0, max - 1)}…` : text;

export function discordEmbed(message: DeliveryMessage): DiscordEmbed {
	return {
		title: clip(message.title, MAX_TITLE),
		...(message.body ? { description: clip(message.body, MAX_DESCRIPTION) } : {}),
		...(message.url ? { url: message.url } : {}),
		color: COLORS[message.kind] ?? DEFAULT_COLOR,
		timestamp: message.createdAt.toISOString(),
	};
}

export interface WebhookSendOptions {
	readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

/** 本文を読む大きさの上限。相手が大きすぎる応答を返しても、読み切ろうとしない */
const MAX_BODY_BYTES = 64 * 1024;

/** 応答の本文を、大きさの上限を守って JSON として読む。形が違えば undefined */
async function readBoundedJson(response: Response): Promise<unknown> {
	const reader = response.body?.getReader();
	if (!reader) return undefined;
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const result: ReadableStreamReadResult<Uint8Array> = await reader.read();
			if (result.done) break;
			const value = result.value;
			total += value.byteLength;
			if (total > MAX_BODY_BYTES) {
				await reader.cancel();
				return undefined;
			}
			chunks.push(value);
		}
	} catch {
		return undefined;
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
	} catch {
		return undefined;
	}
}

/** 429 の待ち時間 (ミリ秒)。Retry-After (秒) を先に、なければ本文の retry_after (秒) を見る */
export async function retryAfterMs(response: Response): Promise<number | null> {
	const header = Number(response.headers.get('retry-after'));
	if (Number.isFinite(header) && header > 0) return Math.ceil(header * 1000);
	const json = await readBoundedJson(response);
	const seconds = (json as { retry_after?: unknown } | undefined)?.retry_after;
	if (typeof seconds === 'number' && seconds > 0) return Math.ceil(seconds * 1000);
	return null;
}

export async function sendViaWebhook(
	url: string,
	message: DeliveryMessage,
	options: WebhookSendOptions = {},
): Promise<SendOutcome> {
	const doFetch = options.fetch ?? fetch;
	let response: Response;
	try {
		response = await doFetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			// メンションは効かせない。通知の題に @everyone を混ぜられても、飛ばない
			body: JSON.stringify({ embeds: [discordEmbed(message)], allowed_mentions: { parse: [] } }),
			redirect: 'manual',
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch {
		return { status: 'retry', afterMs: null, reason: '通信できませんでした' };
	}
	if (response.ok) return { status: 'sent' };
	if (response.status === 404 || response.status === 401) {
		return { status: 'gone', reason: `Webhook が見つかりません (HTTP ${response.status})` };
	}
	if (response.status === 429) {
		return {
			status: 'retry',
			afterMs: await retryAfterMs(response),
			reason: '送りすぎです (HTTP 429)',
		};
	}
	if (response.status >= 500) {
		return {
			status: 'retry',
			afterMs: null,
			reason: `Discord の不調です (HTTP ${response.status})`,
		};
	}
	return { status: 'rejected', reason: `受け付けられませんでした (HTTP ${response.status})` };
}

export async function sendViaBot(
	bot: Pick<DiscordBot, 'postEmbed'>,
	channelId: string,
	message: DeliveryMessage,
): Promise<SendOutcome> {
	try {
		await bot.postEmbed(channelId, discordEmbed(message));
		return { status: 'sent' };
	} catch (error) {
		if (error instanceof DiscordApiError) {
			// 404 はスレッドや DM がない、403 は DM を受け取らない設定や、スレッドから外れた場合
			if (error.status === 404 || error.status === 403) {
				return { status: 'gone', reason: `送り先に送れません (HTTP ${error.status})` };
			}
			if (error.status === 429 || error.status >= 500) {
				return {
					status: 'retry',
					afterMs: null,
					reason: `Discord の不調です (HTTP ${error.status})`,
				};
			}
			return { status: 'rejected', reason: `受け付けられませんでした (HTTP ${error.status})` };
		}
		return { status: 'retry', afterMs: null, reason: '通信できませんでした' };
	}
}
