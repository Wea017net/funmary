// バス停の選択。「A から未来大へ」の A にする停留所を、一覧から選ぶ。選ぶと、バスの画面に戻る。
import { error, type ServerLoad } from '@sveltejs/kit';
import { listBusStops } from '@funmary/api';
import { UNIVERSITY_STOP } from '@funmary/core';
import { requireSignedIn } from '#lib/server/admin.ts';
import { getServices } from '#lib/server/services.ts';

const STOP_COOKIE = 'fm_bus_stop';

export const load: ServerLoad = ({ locals, url, cookies }) => {
	requireSignedIn(locals);
	const listing = listBusStops(getServices());
	if (!listing) error(404, 'このサーバーでは、バスの時刻表を使っていません');
	const direction = url.searchParams.get('direction');
	const day = url.searchParams.get('day');
	return {
		// 一覧は、事業者のコードの順 (函館駅前の側から赤川の側へ、ほぼ路線の順に並ぶ)
		stops: listing.stops
			.filter((stop) => stop.id !== UNIVERSITY_STOP.id)
			.map((stop) => ({ id: stop.id, name: stop.name }))
			.toSorted((a, b) => a.id.localeCompare(b.id)),
		selectedStopId: cookies.get(STOP_COOKIE) ?? null,
		/** バスの画面に戻るときに引き継ぐ向きと日の区分 */
		direction: direction === 'toUniversity' || direction === 'fromUniversity' ? direction : null,
		day: day === 'weekday' || day === 'holiday' ? day : null,
	};
};
