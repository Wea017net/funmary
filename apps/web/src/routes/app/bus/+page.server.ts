// バスの時刻表。強調する停留所 (未来大、亀田支所前) の次のバスと、?stop= で選んだ停留所の発車表を出す。
// 保存した写しだけを読む。BUS_API_BASE_URL がないサーバーでは、この画面はない
import { error, type ServerLoad } from '@sveltejs/kit';
import {
	busDayTypeOn,
	getBusStopTimetable,
	getNextBuses,
	listBusStops,
	type PublicBusStopTimetable,
	type PublicBusStops,
	type PublicNextBuses,
} from '@funmary/api';
import { jstDateTime, type BusDayType } from '@funmary/core';
import { isBusDataStale } from '#lib/bus-label.ts';
import { requireSignedIn } from '#lib/server/admin.ts';
import { getServices } from '#lib/server/services.ts';

/** 強調する停留所の、停留所ごとの件数と、選んだ停留所の件数 */
const HIGHLIGHT_LIMIT = 3;
const SELECTED_LIMIT = 8;

export const load: ServerLoad = ({ locals, url }) => {
	requireSignedIn(locals);
	const services = getServices();
	const now = new Date();
	const stops: PublicBusStops | null = listBusStops(services);
	if (!stops) error(404, 'このサーバーでは、バスの時刻表を使っていません');

	const requestedStop = url.searchParams.get('stop');
	const selectedStopId =
		requestedStop && stops.stops.some((stop) => stop.id === requestedStop) ? requestedStop : null;
	const today = jstDateTime(now).date;
	const todayDay: BusDayType = busDayTypeOn(services, today);
	const requestedDay = url.searchParams.get('day');
	const day: BusDayType =
		requestedDay === 'weekday' || requestedDay === 'holiday' ? requestedDay : todayDay;

	const next: PublicNextBuses | null = getNextBuses(services, now, {
		stopId: selectedStopId ?? undefined,
		limit: selectedStopId ? SELECTED_LIMIT : HIGHLIGHT_LIMIT,
	});
	const timetable: PublicBusStopTimetable | null = selectedStopId
		? getBusStopTimetable(services, now, selectedStopId)
		: null;

	return {
		stops: stops.stops,
		checkedAt: stops.checkedAt,
		stale: isBusDataStale(stops.checkedAt, now),
		selectedStopId,
		day,
		todayDay,
		next: next?.stops ?? [],
		timetable,
	};
};
