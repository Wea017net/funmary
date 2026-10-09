// /mcp の MCP サーバー。公開 API と同じ個人用のアクセストークンで認証し、
// 同じ reads/ の関数を呼ぶので、REST と中身が食い違わない。道具はすべて読み取り専用 (readOnlyHint)。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPTransport } from '@hono/mcp';
import { Hono } from 'hono';
import { z } from 'zod';
import { listUserNotifications, type NotificationsSources } from './reads/notifications.ts';
import { getSubjectDetail } from './reads/subject-detail.ts';
import { buildUserTimetable, type TimetableSources } from './reads/user-timetable.ts';
import type { V1RoutesDeps } from './v1/routes.ts';

/** v1/routes.ts の V1RoutesDeps と同じ形。公開 API と MCP で、同じ依存の組み立てを使い回せるようにする */
export type McpRoutesDeps = V1RoutesDeps;

// MCP の structuredContent は、オブジェクト (record) でなければならない。配列はキーに包んで返す
const jsonText = (value: object) => ({
	content: [{ type: 'text' as const, text: JSON.stringify(value) }],
	structuredContent: value as Record<string, unknown>,
});

/** MCP サーバーを組み立てる。テストでは、SDK の in-memory の接続で道具を直接確かめるのに使う */
export function buildMcpServer(
	deps: McpRoutesDeps,
	owner: { userId: string; scopes: readonly string[] },
) {
	const server = new McpServer({ name: 'funmary', version: '1' });
	const timetableSources: TimetableSources = deps;
	const notificationsSources: NotificationsSources = deps;

	if (owner.scopes.includes('read:lessons')) {
		server.registerTool(
			'get_lessons',
			{
				description: '日付か期間の授業を返す (日付を省くと今日)',
				inputSchema: { start: z.string().optional(), end: z.string().optional() },
				annotations: { readOnlyHint: true },
			},
			({ start, end }) => {
				const today = new Date().toISOString().slice(0, 10);
				const timetable = buildUserTimetable(timetableSources, owner.userId, {
					start: start ?? today,
					end: end ?? start ?? today,
				});
				return jsonText({ lessons: timetable.lessons });
			},
		);
		server.registerTool(
			'get_subject',
			{
				description: '授業の詳細を返す',
				inputSchema: { year: z.number(), syllabusId: z.string() },
				annotations: { readOnlyHint: true },
			},
			({ year, syllabusId }) => {
				const viewer = deps.users.findUserById(owner.userId);
				if (!viewer) return jsonText({ error: 'not_found' });
				const detail = getSubjectDetail(
					deps,
					{ academicYear: year, syllabusId },
					{ id: viewer.id, email: viewer.email, role: viewer.role },
				);
				return jsonText(detail ?? { error: 'not_found' });
			},
		);
	}

	if (owner.scopes.includes('read:changes')) {
		server.registerTool(
			'list_changes',
			{
				description: '日付の範囲の休講、補講、教室変更を返す',
				inputSchema: { start: z.string(), end: z.string() },
				annotations: { readOnlyHint: true },
			},
			({ start, end }) => {
				const timetable = buildUserTimetable(timetableSources, owner.userId, {
					start,
					end,
				});
				return jsonText({
					changes: timetable.lessons.filter((lesson) => lesson.status !== 'normal'),
				});
			},
		);
	}

	if (owner.scopes.includes('read:notifications')) {
		server.registerTool(
			'list_notifications',
			{
				description: '通知欄 (休講、補講、教室変更などの知らせ) を返す',
				inputSchema: { limit: z.number().optional() },
				annotations: { readOnlyHint: true },
			},
			({ limit }) =>
				jsonText({
					notifications: listUserNotifications(
						notificationsSources,
						owner.userId,
						limit === undefined ? {} : { limit },
					),
				}),
		);
	}

	return server;
}

export function createMcpRoutes(deps: McpRoutesDeps): Hono {
	const app = new Hono();
	const BEARER = /^Bearer\s+(\S+)$/;
	app.all('/mcp', async (c) => {
		const match = BEARER.exec(c.req.header('Authorization') ?? '');
		const token = match?.[1];
		const now = new Date();
		const found = token ? deps.accessTokens.findOwner(token, now) : null;
		if (!found) {
			return c.json(
				{ error: 'unauthorized', message: 'Authorization: Bearer <token> が要ります' },
				401,
			);
		}
		deps.accessTokens.markUsed(found.id, now);
		const server = buildMcpServer(deps, { userId: found.userId, scopes: found.scopes });
		const transport = new StreamableHTTPTransport();
		await server.connect(transport);
		return transport.handleRequest(c);
	});
	return app;
}
