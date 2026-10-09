import { type Database } from '@funmary/db';
import { describe, expect, it } from 'vitest';
import { createV1Routes } from './routes.ts';
import { useTestDatabase } from '@funmary/db/testing';
import { createTestApiDeps } from '../testing.ts';

let database: Database;
useTestDatabase('funmary-v1-routes-', (db) => (database = db));

const NOW = new Date('2026-10-07T00:00:00Z');

function deps() {
	return createTestApiDeps(database);
}

function newUser(src: ReturnType<typeof deps>, sub: string) {
	return src.users.createUser(
		{ googleSub: sub, email: `${sub}@fun.ac.jp`, name: null, role: 'user' },
		NOW,
	);
}

describe('createV1Routes', () => {
	it('Authorization ヘッダがなければ 401', async () => {
		const app = createV1Routes(deps());
		const res = await app.request('/api/v1/lessons?start=2026-10-01&end=2026-10-07');
		expect(res.status).toBe(401);
	});

	it('範囲が足りないトークンでは 403', async () => {
		const src = deps();
		const userId = newUser(src, 'a');
		const token = src.accessTokens.issue(
			userId,
			{ name: 'test', scopes: ['read:changes'] },
			new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000),
			NOW,
		);
		const app = createV1Routes(src);
		const res = await app.request('/api/v1/lessons?start=2026-10-01&end=2026-10-07', {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(403);
	});

	it('GET /api/v1/lessons は、その人の授業だけを返す', async () => {
		const src = deps();
		const userId = newUser(src, 'a');
		const token = src.accessTokens.issue(
			userId,
			{ name: 'test', scopes: ['read:lessons'] },
			new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000),
			NOW,
		);
		const app = createV1Routes(src);
		const res = await app.request('/api/v1/lessons?start=2026-10-01&end=2026-10-07', {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([]);
	});

	describe('授業のほかの情報', () => {
		const lessonsApp = () => {
			const src = deps();
			const userId = newUser(src, 'a');
			const token = src.accessTokens.issue(
				userId,
				{ name: 'test', scopes: ['read:lessons'] },
				new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000),
				NOW,
			);
			const app = createV1Routes(src);
			const get = (path: string) =>
				app.request(path, { headers: { Authorization: `Bearer ${token}` } });
			return { src, userId, get };
		};

		it('GET /api/v1/timetable は、授業と days を返す', async () => {
			const { src, get } = lessonsApp();
			src.academicCalendar.saveSubstituteDay({ date: '2026-10-16', weekday: 1 }, 'manual');

			const res = await get('/api/v1/timetable?start=2026-10-12&end=2026-10-18');

			expect(res.status).toBe(200);
			expect(await res.json()).toMatchObject({
				lessons: [],
				days: [{ date: '2026-10-16', kind: 'substitute', weekday: 1 }],
			});
		});

		it('GET /api/v1/timetable/week は、月曜から日曜の格子を返す。日付が不正なら 400', async () => {
			const { get } = lessonsApp();

			const res = await get('/api/v1/timetable/week?date=2026-10-07');

			expect(res.status).toBe(200);
			const grid = (await res.json()) as { weekStart: string; days: unknown[] };
			expect(grid.weekStart).toBe('2026-10-05');
			expect(grid.days).toHaveLength(7);
			expect((await get('/api/v1/timetable/week?date=abc')).status).toBe(400);
		});

		it('GET /api/v1/periods は、時限の時刻を返す', async () => {
			const { get } = lessonsApp();

			const res = await get('/api/v1/periods');

			expect(res.status).toBe(200);
			const periods = (await res.json()) as { number: number; start: string }[];
			expect(periods[0]).toEqual({ number: 1, start: '09:00', end: '10:30' });
		});

		it('GET /api/v1/lessons/next は、授業がなければ next が null', async () => {
			const { get } = lessonsApp();

			const res = await get('/api/v1/lessons/next');

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ next: null });
		});

		it('GET /api/v1/courses は、履修登録がなければ空', async () => {
			const { get } = lessonsApp();

			const res = await get('/api/v1/courses');

			expect(await res.json()).toEqual([]);
		});

		it('GET /api/v1/academic-calendar は、年度を指定できる', async () => {
			const { get } = lessonsApp();

			const res = await get('/api/v1/academic-calendar?year=2026');

			expect(res.status).toBe(200);
			expect(await res.json()).toMatchObject({ academicYear: 2026 });
			expect((await get('/api/v1/academic-calendar?year=abc')).status).toBe(400);
		});

		it('GET /api/v1/events は、自分の予定を日付の範囲で返す', async () => {
			const { src, userId, get } = lessonsApp();
			src.userEvents.create(
				userId,
				{
					title: '架空のサークル',
					location: null,
					notes: null,
					startDate: '2026-10-05',
					endDate: '2026-10-05',
					time: { kind: 'allDay' },
					rrule: null,
					excludedDates: [],
					visibility: 'private',
				},
				NOW,
			);

			const res = await get('/api/v1/events?start=2026-10-01&end=2026-10-07');

			expect(res.status).toBe(200);
			expect(await res.json()).toMatchObject([
				{ title: '架空のサークル', allDay: true, added: false },
			]);
		});

		it('GET /api/v1/status は、データの新しさを返す', async () => {
			const { get } = lessonsApp();

			const res = await get('/api/v1/status');

			expect(await res.json()).toEqual({ timetable: { lastSuccessAt: null, stale: true } });
		});

		it('GET /api/v1/subjects は、科目を探す。GET .../sessions は、見つからなければ 404', async () => {
			const { src, get } = lessonsApp();
			src.subjects.upsert(
				{
					academicYear: 2026,
					syllabusId: '100001',
					name: '架空の代数',
					teacher: null,
					credits: 2,
					term: 'fall',
					attributes: {},
					syllabus: {},
					syllabusUrl: null,
				},
				NOW,
			);

			const found = await get('/api/v1/subjects?year=2026&q=代数');
			const sessions = await get('/api/v1/subjects/2026/100001/sessions');
			const missing = await get('/api/v1/subjects/2026/none/sessions');

			expect(await found.json()).toMatchObject({
				subjects: [{ syllabusId: '100001', name: '架空の代数' }],
				truncated: false,
			});
			expect(sessions.status).toBe(200);
			expect(await sessions.json()).toMatchObject({
				subject: { syllabusId: '100001' },
				sessions: [],
			});
			expect(missing.status).toBe(404);
		});

		it('範囲が足りないトークンでは、どれも 403', async () => {
			const src = deps();
			const userId = newUser(src, 'b');
			const token = src.accessTokens.issue(
				userId,
				{ name: 'test', scopes: ['read:notifications'] },
				new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000),
				NOW,
			);
			const app = createV1Routes(src);
			for (const path of [
				'/api/v1/timetable?start=2026-10-01&end=2026-10-07',
				'/api/v1/periods',
				'/api/v1/lessons/next',
				'/api/v1/courses',
				'/api/v1/academic-calendar',
				'/api/v1/events?start=2026-10-01&end=2026-10-07',
				'/api/v1/status',
				'/api/v1/subjects',
				'/api/v1/subjects/2026/100001/sessions',
			]) {
				const res = await app.request(path, { headers: { Authorization: `Bearer ${token}` } });
				expect(res.status, path).toBe(403);
			}
		});
	});

	it('GET /api/v1/me は、トークンの持ち主の情報を返す', async () => {
		const src = deps();
		const userId = newUser(src, 'a');
		const token = src.accessTokens.issue(
			userId,
			{ name: 'test', scopes: ['read:lessons'] },
			new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000),
			NOW,
		);
		const app = createV1Routes(src);
		const res = await app.request('/api/v1/me', { headers: { Authorization: `Bearer ${token}` } });
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ id: userId, email: 'a@fun.ac.jp' });
	});

	it('GET /api/v1/subjects/:year/:syllabusId は、公開の科目を返す', async () => {
		const src = deps();
		const userId = newUser(src, 'a');
		src.subjects.upsert(
			{
				academicYear: 2026,
				syllabusId: '100201',
				name: '情報処理演習',
				teacher: null,
				credits: 2,
				term: 'spring',
				attributes: {},
				syllabus: {},
				syllabusUrl: null,
			},
			NOW,
		);
		const token = src.accessTokens.issue(
			userId,
			{ name: 'test', scopes: ['read:lessons'] },
			new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000),
			NOW,
		);
		const app = createV1Routes(src);
		const res = await app.request('/api/v1/subjects/2026/100201', {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { subject: { name: string } };
		expect(body.subject.name).toBe('情報処理演習');
	});

	it('GET /api/v1/subjects/:year/:syllabusId は、見つからなければ 404', async () => {
		const src = deps();
		const userId = newUser(src, 'a');
		const token = src.accessTokens.issue(
			userId,
			{ name: 'test', scopes: ['read:lessons'] },
			new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000),
			NOW,
		);
		const app = createV1Routes(src);
		const res = await app.request('/api/v1/subjects/2026/unknown', {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(404);
	});

	it('GET /api/v1/notifications は、kinds で絞れる', async () => {
		const src = deps();
		const userId = newUser(src, 'a');
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
				{
					userId,
					kind: 'makeup',
					title: '補講',
					body: null,
					link: null,
					subjectId: null,
					dedupeKey: null,
				},
			],
			NOW,
		);
		const token = src.accessTokens.issue(
			userId,
			{ name: 'test', scopes: ['read:notifications'] },
			new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000),
			NOW,
		);
		const app = createV1Routes(src);
		const res = await app.request('/api/v1/notifications?kinds=cancellation', {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { kind: string }[];
		expect(body.map((n) => n.kind)).toEqual(['cancellation']);
	});
});
