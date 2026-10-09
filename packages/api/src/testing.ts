// 公開 API と MCP のテストが使う、全部入りの依存 (V1RoutesDeps)。
// 依存を足すたびに、3 つのテストが同じ一覧を直していたので、ここに 1 つだけ置く。
import {
	createAcademicCalendarStore,
	createAccessGrantStore,
	createAccessTokenStore,
	createAuthStore,
	createClassChangeStore,
	createCourseStore,
	createHolidayStore,
	createNotificationStore,
	createPersonalSlotStore,
	createSourceHealthStore,
	createSubjectStore,
	createUserEventStore,
	type Database,
} from '@funmary/db';

export function createTestApiDeps(database: Database) {
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
