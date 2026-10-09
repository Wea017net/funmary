export { createApi, type ApiDeps } from './app.ts';
export {
	currentAcademicYear,
	getAcademicCalendar,
	getNextLesson,
	getPublicTimetable,
	listPeriods,
	listUserCourses,
	LESSON_STATUSES,
	type PublicAcademicCalendar,
	type PublicCourse,
	type PublicDay,
	type PublicLesson,
	type PublicNextLesson,
	type PublicTimetable,
} from './reads/public-data.ts';
export {
	RETURN_COOKIE_MAX_AGE_S,
	SESSION_COOKIE_MAX_AGE_S,
	createAuthRoutes,
	returnCookieName,
	sessionCookieName,
	sessionCookieOptions,
	type AuthRoutesDeps,
	type LoginErrorCode,
} from './auth-routes.ts';
export { createCalendarRoutes, type CalendarRoutesDeps } from './calendar-routes.ts';
export {
	buildIcs,
	type CalendarDayEvent,
	type CalendarFeed,
	type CalendarLesson,
	type CalendarUserEvent,
	type IcsOptions,
} from './ics.ts';
export { createFeedRoutes, type FeedRoutesDeps } from './feed-routes.ts';
export type { FeedInput, FeedItem } from 'hono-feed';
export {
	buildUserTimetable,
	type DayNote,
	type TimetableLesson,
	type TimetableSources,
	type UserTimetable,
} from './reads/user-timetable.ts';
export {
	listUserNotifications,
	type ListNotificationsOptions,
	type NotificationsSources,
} from './reads/notifications.ts';
export {
	getSubjectDetail,
	type SubjectDetail,
	type SubjectDetailSources,
	type SubjectDetailViewer,
} from './reads/subject-detail.ts';
export { createV1Routes, type V1RoutesDeps } from './v1/routes.ts';
export { requireScope, v1Auth, type V1AuthDeps, type V1AuthVariables } from './v1/auth.ts';
export { createOpenApiRoutes } from './v1/openapi.ts';
export { createMcpRoutes, type McpRoutesDeps } from './mcp-routes.ts';
export { createOAuthRoutes, type OAuthRoutesDeps } from './oauth-routes.ts';
export {
	buildRedirect,
	parseAuthorizeRequest,
	type AuthorizeParse,
	type AuthorizeRequest,
} from './oauth-authorize.ts';
export {
	createDiscordInteractionRoutes,
	type DiscordInteractionsDeps,
} from './discord/interactions.ts';
