// 公開 API。個人用のアクセストークンで認証する、読み取り専用の口。
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
import {
	currentAcademicYear,
	getAcademicCalendar,
	getNextLesson,
	getPublicTimetable,
	LESSON_STATUSES,
	listPeriods,
	listUserCourses,
	type AcademicCalendarSources,
	type CourseSources,
} from '../reads/public-data.ts';
import { getSubjectDetail } from '../reads/subject-detail.ts';
import type { TimetableSources } from '../reads/user-timetable.ts';
import { requireScope, v1Auth, type V1AuthVariables } from './auth.ts';

/** 1 分に 60 回まで。トークンごとに数える */
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

export interface V1RoutesDeps
	extends TimetableSources, NotificationsSources, CourseSources, AcademicCalendarSources {
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
	date: v.pipe(v.string(), v.description('YYYY-MM-DD (日本時間)')),
	period: v.pipe(v.number(), v.description('時限の番号。時刻は start と end')),
	start: v.pipe(
		v.nullable(v.string()),
		v.description('HH:MM (日本時間)。時限の時刻が不明なら null'),
	),
	end: v.nullable(v.string()),
	subjectId: v.number(),
	subjectName: v.string(),
	academicYear: v.number(),
	syllabusId: v.string(),
	room: v.pipe(v.nullable(v.string()), v.description('教室。分からなければ null')),
	roomIsTentative: v.pipe(
		v.boolean(),
		v.description('補講の教室が分からず、ふだんの教室を仮に出しているとき true'),
	),
	status: v.pipe(
		v.picklist(LESSON_STATUSES),
		v.description('normal: 変更なし、cancelled: 休講、makeup: 補講、roomChanged: 教室変更'),
	),
});

const DaySchema = v.variant('kind', [
	v.object({
		date: v.string(),
		kind: v.literal('substitute'),
		weekday: v.pipe(v.number(), v.description('この日に行う授業の曜日。1 (月) から 7 (日)')),
	}),
	v.object({ date: v.string(), kind: v.literal('noClass'), label: v.nullable(v.string()) }),
	v.object({ date: v.string(), kind: v.literal('holiday'), name: v.string() }),
]);

const PeriodSchema = v.object({
	number: v.number(),
	start: v.pipe(v.string(), v.description('HH:MM (日本時間)')),
	end: v.string(),
});

const SlotSchema = v.object({
	weekday: v.pipe(v.number(), v.description('1 (月) から 7 (日)')),
	period: v.number(),
	room: v.nullable(v.string()),
});

const CourseSchema = v.object({
	subjectId: v.number(),
	academicYear: v.number(),
	syllabusId: v.string(),
	name: v.string(),
	teacher: v.nullable(v.string()),
	credits: v.nullable(v.number()),
	term: v.string(),
	slots: v.array(SlotSchema),
});

const TimetableSchema = v.object({
	lessons: v.array(LessonSchema),
	days: v.pipe(
		v.array(DaySchema),
		v.description('授業の日の置き換え (振替授業日)、全学の休講日、祝日'),
	),
	usesEstimatedTerms: v.pipe(v.boolean(), v.description('学期の期間に、規則で推定した値を使った')),
});

const AcademicCalendarSchema = v.object({
	academicYear: v.number(),
	terms: v.array(
		v.object({
			term: v.string(),
			start: v.string(),
			end: v.string(),
			source: v.pipe(v.string(), v.description('manual、auto、estimated')),
		}),
	),
	days: v.array(DaySchema),
});

const AcademicCalendarQuery = v.object({
	/** 省けば今日が属する年度 */
	year: v.optional(
		v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(2000), v.maxValue(2100)),
	),
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
	'/api/v1/lessons/next',
	'/api/v1/timetable',
	'/api/v1/periods',
	'/api/v1/courses',
	'/api/v1/academic-calendar',
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
			return c.json(getPublicTimetable(deps, userId, { start, end }).lessons);
		},
	);

	app.get(
		'/api/v1/lessons/next',
		requireScope('read:lessons'),
		describeRoute({
			description:
				'次の授業を返す。授業中ならその授業 (inProgress が true)。休講の授業は飛ばし、14 日先まで見て、なければ next が null',
			responses: {
				200: {
					description: 'OK',
					content: {
						'application/json': {
							schema: resolver(
								v.object({
									next: v.nullable(v.object({ ...LessonSchema.entries, inProgress: v.boolean() })),
								}),
							),
						},
					},
				},
			},
		}),
		(c) => c.json(getNextLesson(deps, c.get('tokenOwner').userId, new Date())),
	);

	app.get(
		'/api/v1/timetable',
		requireScope('read:lessons'),
		describeRoute({
			description:
				'日付の範囲の授業 (時刻つき) と、授業の日に関わる事情 (振替授業日、全学の休講日、祝日) を返す',
			responses: {
				200: {
					description: 'OK',
					content: { 'application/json': { schema: resolver(TimetableSchema) } },
				},
			},
		}),
		validator('query', RangeQuery),
		(c) => {
			const { start, end } = c.req.valid('query');
			return c.json(getPublicTimetable(deps, c.get('tokenOwner').userId, { start, end }));
		},
	);

	app.get(
		'/api/v1/periods',
		requireScope('read:lessons'),
		describeRoute({
			description: '時限ごとの開始と終了の時刻 (日本時間)',
			responses: {
				200: {
					description: 'OK',
					content: { 'application/json': { schema: resolver(v.array(PeriodSchema)) } },
				},
			},
		}),
		(c) => c.json(listPeriods()),
	);

	app.get(
		'/api/v1/courses',
		requireScope('read:lessons'),
		describeRoute({
			description: '履修登録した科目と、その曜日と時限',
			responses: {
				200: {
					description: 'OK',
					content: { 'application/json': { schema: resolver(v.array(CourseSchema)) } },
				},
			},
		}),
		(c) => c.json(listUserCourses(deps, c.get('tokenOwner').userId)),
	);

	app.get(
		'/api/v1/academic-calendar',
		requireScope('read:lessons'),
		describeRoute({
			description:
				'年度の学期の期間と、その年度の祝日、全学の休講日、振替授業日 (year を省けば今日が属する年度)',
			responses: {
				200: {
					description: 'OK',
					content: { 'application/json': { schema: resolver(AcademicCalendarSchema) } },
				},
			},
		}),
		validator('query', AcademicCalendarQuery),
		(c) => {
			const { year } = c.req.valid('query');
			return c.json(getAcademicCalendar(deps, year ?? currentAcademicYear(new Date())));
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
			const { lessons } = getPublicTimetable(deps, userId, { start, end });
			return c.json(lessons.filter((lesson) => lesson.status !== 'normal'));
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
