import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createOpenApiRoutes } from './openapi.ts';
import { createV1Routes } from './routes.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-openapi-routes-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

function app() {
	const deps = {
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
	const v1 = createV1Routes(deps);
	const root = new Hono();
	root.route('/', v1);
	root.route('/', createOpenApiRoutes(v1));
	return root;
}

describe('/api/v1/openapi.json', () => {
	it('OpenAPI 3.1 の定義が作れ、/api/v1 の道が載る。ログインなしで開ける', async () => {
		const res = await app().request('/api/v1/openapi.json');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
		expect(body.openapi).toMatch(/^3\.1/);
		expect(Object.keys(body.paths)).toEqual(
			expect.arrayContaining([
				'/api/v1/lessons',
				'/api/v1/changes',
				'/api/v1/notifications',
				'/api/v1/me',
			]),
		);
	});
});

describe('/api/v1/openapi.json の webhooks', () => {
	it('汎用 Webhook に送る通知の形を、webhooks として載せる (#165)', async () => {
		const res = await app().request('/api/v1/openapi.json');
		const body = (await res.json()) as { webhooks?: Record<string, unknown> };
		expect(Object.keys(body.webhooks ?? {})).toEqual(['notification']);
		expect(JSON.stringify(body.webhooks)).toContain('webhook-signature');
	});
});

describe('/api/docs', () => {
	it('Swagger UI の画面を、ログインなしで返す', async () => {
		const res = await app().request('/api/docs');
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toContain('text/html');
	});
});
