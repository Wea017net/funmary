// バスの時刻表。「A から未来大へ」「未来大から A へ」の発車だけを出す (A は、未来大を通る任意の停留所)。
// 選んだ停留所は、次に開いたときのために、Cookie に残す。向きは、残さず、いる場所から決める:
// 学内の Wi-Fi (CAMPUS_IP_RANGES) なら未来大から出る向き、そうでなければ未来大へ向かう向き。
// 現在地での判定は、ブラウザ側で行い、向きを URL に足して開き直す。保存した写しだけを読む。
// BUS_API_BASE_URL がないサーバーでは、この画面はない
import { error, type ServerLoad } from '@sveltejs/kit';
import { getBusLeg, listBusStops, type PublicBusLeg } from '@funmary/api';
import {
	BUS_DIRECTIONS,
	DEFAULT_BUS_STOP_IDS,
	UNIVERSITY_STOP,
	isInIpRanges,
	jstDateTime,
	type BusDayType,
	type BusDirection,
} from '@funmary/core';
import { isBusDataStale } from '#lib/bus-label.ts';
import { requireSignedIn } from '#lib/server/admin.ts';
import { getServices } from '#lib/server/services.ts';

const BUS_STOP_COOKIE = 'fm_bus_stop';
const ONE_YEAR_S = 365 * 24 * 60 * 60;

const isDirection = (value: string | null | undefined): value is BusDirection =>
	(BUS_DIRECTIONS as readonly (string | null | undefined)[]).includes(value);

export const load: ServerLoad = ({ locals, url, cookies, getClientAddress }) => {
	requireSignedIn(locals);
	const services = getServices();
	const now = new Date();
	const listing = listBusStops(services);
	if (!listing) error(404, 'このサーバーでは、バスの時刻表を使っていません');

	// 未来大そのものは、A にならない
	const selectable = listing.stops.filter((stop) => stop.id !== UNIVERSITY_STOP.id);
	const known = (id: string | null | undefined): id is string =>
		id !== null && id !== undefined && selectable.some((stop) => stop.id === id);

	const requestedStop = url.searchParams.get('stop');
	const savedStop = cookies.get(BUS_STOP_COOKIE);
	const stopId =
		(known(requestedStop) && requestedStop) ||
		(known(savedStop) && savedStop) ||
		DEFAULT_BUS_STOP_IDS.find((id) => known(id)) ||
		selectable[0]?.id ||
		null;
	// 利用者が選んだ停留所だけを、覚える
	if (known(requestedStop)) {
		cookies.set(BUS_STOP_COOKIE, requestedStop, {
			path: '/',
			maxAge: ONE_YEAR_S,
			sameSite: 'lax',
			httpOnly: true,
			secure: url.protocol === 'https:',
		});
	}

	// 向き: URL で決めたもの、学内の Wi-Fi、それ以外 (未来大へ) の順
	const requestedDirection = url.searchParams.get('direction');
	let onCampus = false;
	if (services.campusIpRanges.length > 0) {
		try {
			onCampus = isInIpRanges(getClientAddress(), services.campusIpRanges);
		} catch {
			onCampus = false;
		}
	}
	const direction: BusDirection = isDirection(requestedDirection)
		? requestedDirection
		: onCampus
			? 'fromUniversity'
			: 'toUniversity';

	const requestedDay = url.searchParams.get('day');
	const day: BusDayType | undefined =
		requestedDay === 'weekday' || requestedDay === 'holiday' ? requestedDay : undefined;
	const leg: PublicBusLeg | null = stopId
		? getBusLeg(services, now, { stopId, direction, day })
		: null;

	return {
		stopId,
		direction,
		/** 向きを URL で決めていないとき、ブラウザの現在地で決め直してよい (学内の Wi-Fi で決まったときは、決め直さない) */
		canDecideByLocation: !isDirection(requestedDirection) && !onCampus,
		onCampus,
		leg,
		universityName: UNIVERSITY_STOP.name,
		/** いまの日本時間 (HH:MM)。発車の済んだ便を薄く出すのに使う */
		nowTime: jstDateTime(now).time,
		checkedAt: listing.checkedAt,
		stale: isBusDataStale(listing.checkedAt, now),
		hasStops: selectable.length > 0,
	};
};
