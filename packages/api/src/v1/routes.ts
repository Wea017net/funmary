// 公開 API (設計書 3.3)。個人用のアクセストークンで認証する、読み取り専用の口。
// 読み取りの処理は reads/ の関数にまとめ、画面・MCP (mcp-routes.ts) と同じ関数を呼ぶ。
import type {
	AccessGrantStore,
	AccessTokenStore,
	AuthStore,
	ClassChangeStore,
	NotificationKind,
	NotificationStore,
	SubjectStore,
} from '@funmary/db';
import { Hono } from 'hono';
import { describeRoute, resolver, validator } from 'hono-openapi';
import { rateLimiter } from 'hono-rate-limiter';
import * as v from 'valibot';
import { listUserNotifications, type NotificationsSources } from '../reads/notifications.ts';
import { getSubjectDetail } from '../reads/subject-detail.ts';
import { buildUserTimetable, type TimetableSources } from '../reads/user-timetable.ts';
import { requireScope, v1Auth, type V1AuthVariables } from './auth.ts';

/** 1 分に 60 回まで。トークンごとに数える (設計書 3.3) */
const RATE_LIMIT = { windowMs: 60 * 1000, limit: 60 };

const NOTIFICATION_KINDS: readonly NotificationKind[] = [
	'cancellation',
	'makeup',
	'roomChange',
	'integration',
	'notice',
];
const isNotificationKind = (value: string): value is NotificationKind =>
	(NOTIFICATION_KINDS as readonly string[]).includes(value);

export interface V1RoutesDeps extends TimetableSources, NotificationsSources {
	readonly subjects: Pick<SubjectStore, 'findById' | 'findBySyllabus'>;
	readonly accessGrants: Pick<AccessGrantStore, 'isGranted'>;
	readonly classChanges: TimetableSources['classChanges'] & Pick<ClassChangeStore, 'listBySubject'>;
	readonly notifications: Pick<NotificationStore, 'list'>;
	readonly accessTokens: Pick<AccessTokenStore, 'findOwner' | 'markUsed'>;
	readonly users: Pick<AuthStore, 'findUserById'>;
}

const DateParam = v.pipe(v.string(), v.isoDate());

const RangeQuery = v.object({
	start: DateParam,
	end: DateParam,
});

const NotificationsQuery = v.object({
	/** カンマ区切り。省けばすべての種類 */
	kinds: v.optional(v.string()),
	since: v.optional(DateParam),
	limit: v.optional(
		v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(200)),
	),
});

const SubjectParam = v.object({
	year: v.pipe(v.string(), v.transform(Number), v.integer()),
	syllabusId: v.string(),
});

const LessonSchema = v.object({
	date: v.string(),
	period: v.number(),
	subjectId: v.number(),
	subjectName: v.string(),
	academicYear: v.number(),
	syllabusId: v.string(),
	room: v.nullable(v.string()),
	status: v.picklist(['normal', 'cancelled', 'makeup', 'roomChanged']),
});

const NotificationSchema = v.object({
	id: v.number(),
	kind: v.string(),
	title: v.string(),
	body: v.nullable(v.string()),
	link: v.nullable(v.string()),
	createdAt: v.string(),
});

// /api/v1/openapi.json と /api/docs は認証なしで開けるので、ここには含めない (別の Hono アプリで配る)
const AUTHED_PATHS = [
	'/api/v1/lessons',
	'/api/v1/changes',
	'/api/v1/subjects/:year/:syllabusId',
	'/api/v1/notifications',
	'/api/v1/me',
] as const;

export function createV1Routes(deps: V1RoutesDeps): Hono<{ Variables: V1AuthVariables }> {
	const app = new Hono<{ Variables: V1AuthVariables }>();
	const auth = v1Auth({ accessTokens: deps.accessTokens });
	const limit = rateLimiter({
		...RATE_LIMIT,
		standardHeaders: 'draft-7',
		keyGenerator: (c) => c.req.header('Authorization') ?? '',
	});
	for (const path of AUTHED_PATHS) {
		app.use(path, auth);
		app.use(path, limit);
	}

	app.get(
		'/api/v1/lessons',
		requireScope('read:lessons'),
		describeRoute({
			description: '日付の範囲の授業を返す',
			responses: {
				200: {
					description: 'OK',
					content: { 'application/json': { schema: resolver(v.array(LessonSchema)) } },
				},
			},
		}),
		validator('query', RangeQuery),
		(c) => {
			const { start, end } = c.req.valid('query');
			const { userId } = c.get('tokenOwner');
			const timetable = buildUserTimetable(deps, userId, {
				start: start,
				end: end,
			});
			return c.json(timetable.lessons);
		},
	);

	app.get(
		'/api/v1/changes',
		requireScope('read:changes'),
		describeRoute({
			description: '日付の範囲の休講、補講、教室変更を返す',
			responses: {
				200: {
					description: 'OK',
					content: { 'application/json': { schema: resolver(v.array(LessonSchema)) } },
				},
			},
		}),
		validator('query', RangeQuery),
		(c) => {
			const { start, end } = c.req.valid('query');
			const { userId } = c.get('tokenOwner');
			const timetable = buildUserTimetable(deps, userId, {
				start: start,
				end: end,
			});
			return c.json(timetable.lessons.filter((lesson) => lesson.status !== 'normal'));
		},
	);

	app.get(
		'/api/v1/subjects/:year/:syllabusId',
		requireScope('read:lessons'),
		describeRoute({ description: '授業の詳細を返す' }),
		validator('param', SubjectParam),
		(c) => {
			const { year, syllabusId } = c.req.valid('param');
			const viewer = deps.users.findUserById(c.get('tokenOwner').userId);
			if (!viewer) return c.json({ error: 'not_found' }, 404);
			const detail = getSubjectDetail(
				deps,
				{ academicYear: year, syllabusId },
				{ id: viewer.id, email: viewer.email, role: viewer.role },
			);
			if (!detail) return c.json({ error: 'not_found' }, 404);
			return c.json(detail);
		},
	);

	app.get(
		'/api/v1/notifications',
		requireScope('read:notifications'),
		describeRoute({
			description: '通知欄を返す',
			responses: {
				200: {
					description: 'OK',
					content: { 'application/json': { schema: resolver(v.array(NotificationSchema)) } },
				},
			},
		}),
		validator('query', NotificationsQuery),
		(c) => {
			const { kinds, since, limit } = c.req.valid('query');
			const { userId } = c.get('tokenOwner');
			const list = listUserNotifications(deps, userId, {
				...(kinds
					? {
							kinds: kinds
								.split(',')
								.map((kind) => kind.trim())
								.filter(isNotificationKind),
						}
					: {}),
				...(since ? { since: new Date(since) } : {}),
				...(limit === undefined ? {} : { limit }),
			});
			return c.json(list);
		},
	);

	app.get('/api/v1/me', describeRoute({ description: 'トークンの持ち主の情報を返す' }), (c) => {
		const { userId, scopes } = c.get('tokenOwner');
		const user = deps.users.findUserById(userId);
		if (!user) return c.json({ error: 'not_found' }, 404);
		return c.json({ id: user.id, email: user.email, scopes });
	});

	return app;
}
