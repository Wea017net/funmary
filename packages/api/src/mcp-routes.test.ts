import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
	createAcademicCalendarStore,
	createAccessGrantStore,
	createAccessTokenStore,
	createAuthStore,
	createClassChangeStore,
	createCourseStore,
	createHolidayStore,
	createNotificationStore,
	createSourceHealthStore,
	createUserEventStore,
	createPersonalSlotStore,
	createSubjectStore,
	openDatabase,
	type Database,
} from '@funmary/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer, createMcpRoutes } from './mcp-routes.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-mcp-routes-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date('2026-10-07T00:00:00Z');

function deps() {
	return {
		courses: createCourseStore(database),
		personalSlots: createPersonalSlotStore(database),
		subjects: createSubjectStore(database),
		classChanges: createClassChangeStore(database),
		academicCalendar: createAcademicCalendarStore(database),
		holidays: createHolidayStore(database),
		estimateHolidays: () => [],
		notifications: createNotificationStore(database),
		userEvents: createUserEventStore(database),
		sourceHealth: createSourceHealthStore(database),
		accessGrants: createAccessGrantStore(database),
		accessTokens: createAccessTokenStore(database),
		users: createAuthStore(database),
	};
}

async function connectedClient(server: ReturnType<typeof buildMcpServer>) {
	const client = new Client({ name: 'test', version: '1' });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
	return client;
}

describe('buildMcpServer', () => {
	it('範囲に合わせて、道具の一覧が変わる', async () => {
		const src = deps();
		const server = buildMcpServer(src, { userId: 'u1', scopes: ['read:lessons'] });
		const client = await connectedClient(server);
		const { tools } = await client.listTools();
		expect(tools.map((tool) => tool.name).sort()).toEqual([
			'get_academic_calendar',
			'get_data_status',
			'get_lessons',
			'get_next_lesson',
			'get_periods',
			'get_subject',
			'get_subject_sessions',
			'list_courses',
			'list_events',
			'search_subjects',
		]);
		expect(tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(true);
	});

	it('すべての範囲を持つトークンでは、12 の道具がそろう', async () => {
		const src = deps();
		const server = buildMcpServer(src, {
			userId: 'u1',
			scopes: ['read:lessons', 'read:changes', 'read:notifications'],
		});
		const client = await connectedClient(server);
		const { tools } = await client.listTools();
		expect(tools.map((tool) => tool.name).sort()).toEqual([
			'get_academic_calendar',
			'get_data_status',
			'get_lessons',
			'get_next_lesson',
			'get_periods',
			'get_subject',
			'get_subject_sessions',
			'list_changes',
			'list_courses',
			'list_events',
			'list_notifications',
			'search_subjects',
		]);
	});

	it('get_lessons は、呼んだ本人の授業だけを返す', async () => {
		const src = deps();
		const userId = src.users.createUser(
			{ googleSub: 'a', email: 'a@fun.ac.jp', name: null, role: 'user' },
			NOW,
		);
		const server = buildMcpServer(src, { userId, scopes: ['read:lessons'] });
		const client = await connectedClient(server);
		const result = await client.callTool({
			name: 'get_lessons',
			arguments: { start: '2026-10-01', end: '2026-10-07' },
		});
		expect(result.structuredContent).toMatchObject({ lessons: [], days: [] });
	});

	it('get_periods は時限の時刻を、get_next_lesson は授業がなければ null を返す', async () => {
		const src = deps();
		const server = buildMcpServer(src, { userId: 'u1', scopes: ['read:lessons'] });
		const client = await connectedClient(server);

		const periods = await client.callTool({ name: 'get_periods', arguments: {} });
		const next = await client.callTool({ name: 'get_next_lesson', arguments: {} });

		const list = (periods.structuredContent as { periods: { number: number }[] }).periods;
		expect(list[0]).toEqual({ number: 1, start: '09:00', end: '10:30' });
		expect(list).toHaveLength(6);
		expect(next.structuredContent).toEqual({ next: null });
	});

	it('list_notifications は、呼んだ本人の通知欄だけを返す', async () => {
		const src = deps();
		const userId = src.users.createUser(
			{ googleSub: 'a', email: 'a@fun.ac.jp', name: null, role: 'user' },
			NOW,
		);
		src.notifications.insertMany(
			[
				{
					userId,
					kind: 'cancellation',
					title: '休講',
					body: null,
					link: null,
					subjectId: null,
					dedupeKey: null,
				},
			],
			NOW,
		);
		const server = buildMcpServer(src, { userId, scopes: ['read:notifications'] });
		const client = await connectedClient(server);
		const result = await client.callTool({ name: 'list_notifications', arguments: {} });
		expect(result.structuredContent).toMatchObject({ notifications: [{ title: '休講' }] });
	});
});

describe('OAuth 向けの案内', () => {
	it('トークンなしの 401 に、保護されたリソースの情報の URL を載せる', async () => {
		const app = createMcpRoutes({
			...deps(),
			resourceMetadataUrl: 'https://funmary.example.com/.well-known/oauth-protected-resource/mcp',
		});

		const res = await app.request('/mcp', { method: 'POST' });

		expect(res.status).toBe(401);
		expect(res.headers.get('WWW-Authenticate')).toBe(
			'Bearer resource_metadata="https://funmary.example.com/.well-known/oauth-protected-resource/mcp"',
		);
	});

	it('オリジンを渡すと、サーバーの情報に、アイコンの絶対 URL を載せる', async () => {
		const server = buildMcpServer(
			{ ...deps(), origin: 'https://funmary.example.com/' },
			{ userId: 'u1', scopes: [] },
		);
		const client = await connectedClient(server);

		const icons = client.getServerVersion()?.icons ?? [];

		expect(icons.map((icon) => icon.src)).toEqual([
			'https://funmary.example.com/brand/icon-512.png',
			'https://funmary.example.com/brand/icon.svg',
			'https://funmary.example.com/brand/icon-dark.svg',
		]);
	});
});
