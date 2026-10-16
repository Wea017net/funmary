// 今日の画面。次の授業の時刻と教室を大きく出し、今日の授業と休講などを並べる。
import { type ServerLoad } from '@sveltejs/kit';
import { buildUserTimetable, getBusLeg, listBusStops } from '@funmary/api';
import {
	DEFAULT_PERIODS,
	UNIVERSITY_STOP,
	type BusDirection,
	addDays,
	findNextLesson,
	isStale,
	jstDateTime,
} from '@funmary/core';
import { PORTAL_SOURCE } from '@funmary/jobs';
import { BUS_STOP_COOKIE } from '#lib/bus-state.ts';
import { chooseBusStopId, defaultBusDirection } from '#lib/server/bus-selection.ts';
import { getServices } from '#lib/server/services.ts';
import { eventsOnDate } from '#lib/server/event-view.ts';
import { toLessonView } from '#lib/server/lesson-view.ts';
import { requireSignedIn } from '#lib/server/admin.ts';

/** 次の授業を探す日数。長い休みの間は見つからなくてよい */
const LOOKAHEAD_DAYS = 14;

/**
 * ホームに出す、次のバス。向きは画面が現在地で選び直せるよう、両方の向きを返す。
 * バスの機能がない、時刻表が空のときは null
 */
function nextBus(
	services: ReturnType<typeof getServices>,
	savedStopId: string | undefined,
	getClientAddress: () => string,
	now: Date,
) {
	const listing = listBusStops(services);
	if (!listing) return null;
	const stopId = chooseBusStopId(
		savedStopId,
		listing.stops.filter((stop) => stop.id !== UNIVERSITY_STOP.id).map((stop) => stop.id),
	);
	if (!stopId) return null;
	const { direction: defaultDirection, onCampus } = defaultBusDirection(
		getClientAddress,
		services.campus.ranges(),
	);
	const summarize = (direction: BusDirection) => {
		const leg = getBusLeg(services, now, { stopId, direction });
		if (!leg || leg.checkedAt === null || leg.departures.length === 0) return null;
		const next = leg.upcoming[0];
		return {
			from: leg.from.name,
			to: leg.to.name,
			next: next && {
				time: next.time,
				routes: [...next.routes],
				destination: next.destination,
				from: next.from.name,
				to: next.to.name,
				// 開いたままでも「あと N 分」を合わせられるよう、発車の時刻 (ミリ秒) で渡す
				departsAt: now.getTime() + next.minutesUntil * 60_000,
			},
		};
	};
	const legs = {
		toUniversity: summarize('toUniversity'),
		fromUniversity: summarize('fromUniversity'),
	};
	if (!legs.toUniversity && !legs.fromUniversity) return null;
	return {
		defaultDirection,
		/** 学内の Wi-Fi で決まったときは、現在地で決め直さない */
		canDecideByLocation: !onCampus,
		legs,
	};
}

export const load: ServerLoad = ({ locals, cookies, getClientAddress }) => {
	requireSignedIn(locals);

	const now = new Date();
	const current = jstDateTime(now);
	const services = getServices();
	const timetable = buildUserTimetable(services, locals.user.id, {
		start: current.date,
		end: addDays(current.date, LOOKAHEAD_DAYS - 1),
	});
	const next = findNextLesson(timetable.lessons, current, DEFAULT_PERIODS);
	const portal = services.sourceHealth.load(PORTAL_SOURCE);
	const hasRegistrations = services.courses.listRegistrations(locals.user.id).length > 0;

	// 自分の予定と、ほかの人の予定のうち自分の時間割に加えたもの
	const userEvents = services.userEvents.listByOwner(locals.user.id);
	const addedEvents = services.userEvents.listSubscribed(locals.user);

	return {
		bus: nextBus(services, cookies.get(BUS_STOP_COOKIE), getClientAddress, now),
		today: {
			date: current.date,
			note: timetable.notes.get(current.date) ?? null,
			lessons: timetable.lessons.filter((lesson) => lesson.date === current.date).map(toLessonView),
			events: eventsOnDate(
				[...userEvents, ...addedEvents],
				current.date,
				new Set(addedEvents.map((event) => event.id)),
			),
			next: next && { ...toLessonView(next.lesson), inProgress: next.inProgress },
			hasRegistrations,
			// 履修科目を登録したら、カレンダーに入れられることを知らせる
			suggestCalendar:
				hasRegistrations && services.feedTokens.current(locals.user.id, 'calendar') === null,
			usesEstimatedTerms: timetable.usesEstimatedTerms,
			fetchedAt: portal.lastSuccessAt && jstDateTime(portal.lastSuccessAt),
			stale: isStale(portal.lastSuccessAt, now),
		},
	};
};
