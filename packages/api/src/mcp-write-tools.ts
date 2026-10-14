// MCP の書き込みの道具。範囲 (write:events、write:notifications) を持つトークンにだけ出す。
// 処理は REST と同じ writes/ の関数を呼ぶので、検査も履歴も食い違わない。
// 書き込みの道具には readOnlyHint: false を付け、クライアントが実行の前に利用者へ承認を求められるようにする。
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as v from 'valibot';
import { z } from 'zod';
import { EventBodySchema, type EventBody } from './writes/event-json.ts';
import { createEvent, deleteEvent, replaceEvent, type WriteActor } from './writes/events.ts';
import type { EventWriteSources } from './writes/events.ts';
import {
	markAllNotificationsRead,
	markNotificationRead,
	type NotificationWriteSources,
} from './writes/notifications.ts';

export interface McpWriteOwner {
	readonly userId: string;
	readonly scopes: readonly string[];
	readonly tokenId?: number;
	readonly tokenName?: string;
}

const jsonResult = (value: object) => ({
	content: [{ type: 'text' as const, text: JSON.stringify(value) }],
	structuredContent: value as Record<string, unknown>,
});

const errorResult = (message: string) => ({
	isError: true,
	content: [{ type: 'text' as const, text: message }],
});

/** 予定の項目。足すときと直すときで同じ (REST の本文と同じ形) */
const eventShape = {
	title: z.string().describe('予定の名前 (100 文字まで)'),
	location: z.string().nullable().optional().describe('場所 (100 文字まで)'),
	notes: z.string().nullable().optional().describe('メモ (1000 文字まで)'),
	startDate: z.string().describe('開始日 (YYYY-MM-DD)'),
	endDate: z
		.string()
		.nullable()
		.optional()
		.describe('終了日 (YYYY-MM-DD)。省けば開始日と同じ。数日にわたる予定は終日だけ'),
	time: z
		.discriminatedUnion('kind', [
			z.object({ kind: z.literal('allDay') }),
			z.object({
				kind: z.literal('time'),
				start: z.string().describe('HH:MM (日本時間)'),
				end: z.string().describe('HH:MM。始まりより後'),
			}),
			z.object({
				kind: z.literal('period'),
				from: z.number().describe('始まりの時限 (1 から 6)'),
				to: z.number().describe('終わりの時限 (始まり以上、6 まで)'),
			}),
		])
		.describe('終日、時刻、時限のどれか'),
	repeat: z
		.object({
			freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
			interval: z.number().optional().describe('間隔 (1 から 99)。省けば 1'),
			weekdays: z
				.array(z.number())
				.optional()
				.describe('weekly のとき。曜日 (月曜が 1、日曜が 7)。省けば開始日の曜日'),
			monthly: z
				.enum(['day', 'nth', 'last'])
				.optional()
				.describe('monthly のとき。day は毎月の同じ日、nth は第何曜日、last は最終週の曜日'),
			end: z
				.discriminatedUnion('kind', [
					z.object({ kind: z.literal('never') }),
					z.object({ kind: z.literal('until'), date: z.string() }),
					z.object({ kind: z.literal('count'), count: z.number() }),
				])
				.optional()
				.describe('省けば、終わりなし'),
		})
		.nullable()
		.optional()
		.describe('繰り返さないなら省くか null'),
	excludedDates: z
		.array(z.string())
		.optional()
		.describe('繰り返しから除く日 (YYYY-MM-DD。始まりの日で数える)'),
};

export function registerWriteTools(
	server: McpServer,
	sources: EventWriteSources & NotificationWriteSources,
	owner: McpWriteOwner,
) {
	const actor: WriteActor = {
		userId: owner.userId,
		tokenId: owner.tokenId ?? null,
		tokenName: owner.tokenName ?? 'MCP',
	};
	const parseBody = (
		input: unknown,
	):
		| { readonly ok: true; readonly body: EventBody }
		| { readonly ok: false; readonly error: string } => {
		const parsed = v.safeParse(EventBodySchema, input);
		return parsed.success
			? { ok: true, body: parsed.output }
			: { ok: false, error: parsed.issues[0]?.message ?? '入力が正しくありません' };
	};

	if (owner.scopes.includes('write:events')) {
		server.registerTool(
			'create_event',
			{
				description:
					'自分の予定を足す。公開範囲は決められず、常に非公開で足す。足した予定 (id つき) を返す。1 分あたり 20 回まで',
				inputSchema: eventShape,
				annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
			},
			(args) => {
				const input = parseBody(args);
				if (!input.ok) return errorResult(input.error);
				const result = createEvent(sources, actor, input.body, new Date());
				return result.ok ? jsonResult(result.event) : errorResult(result.error);
			},
		);
		server.registerTool(
			'update_event',
			{
				description:
					'自分の予定を、送った内容に置き換える (送らなかった項目は、空になる)。先に get_event で今の内容を読み、変える項目だけを書き換えて送る。公開範囲は変わらない',
				inputSchema: { id: z.number().describe('予定の id'), ...eventShape },
				annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
			},
			({ id, ...rest }) => {
				const input = parseBody(rest);
				if (!input.ok) return errorResult(input.error);
				const result = replaceEvent(sources, actor, id, input.body, new Date());
				return result.ok ? jsonResult(result.event) : errorResult(result.error);
			},
		);
		server.registerTool(
			'delete_event',
			{
				description: '自分の予定を消す。元には戻せないので、消す前に、利用者に確かめる',
				inputSchema: { id: z.number().describe('予定の id') },
				annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
			},
			({ id }) => {
				const result = deleteEvent(sources, actor, id, new Date());
				return result.ok ? jsonResult({ deleted: true, id }) : errorResult(result.error);
			},
		);
	}

	if (owner.scopes.includes('write:notifications')) {
		server.registerTool(
			'mark_notification_read',
			{
				description: '通知を 1 件、既読にして返す',
				inputSchema: { id: z.number().describe('通知の id') },
				annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
			},
			({ id }) => {
				const result = markNotificationRead(sources, actor, id, new Date());
				return result.ok ? jsonResult(result.notification) : errorResult(result.error);
			},
		);
		server.registerTool(
			'mark_all_notifications_read',
			{
				description: '未読の通知をすべて既読にし、既読にした件数を返す',
				inputSchema: {},
				annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
			},
			() => jsonResult({ count: markAllNotificationsRead(sources, actor, new Date()).count }),
		);
	}
}
