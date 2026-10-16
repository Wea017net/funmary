// バス停の選択。「A から未来大へ」の A にする停留所を、一覧から選ぶ。選ぶと、Cookie に残して、バスの画面に戻る。
import { error, fail, redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import { listBusStops } from '@funmary/api';
import { UNIVERSITY_STOP } from '@funmary/core';
import { BUS_STOP_COOKIE } from '#lib/bus-state.ts';
import { requireSignedIn } from '#lib/server/admin.ts';
import { getServices } from '#lib/server/services.ts';

const ONE_YEAR_S = 365 * 24 * 60 * 60;

/** 未来大そのものは、選べない */
const selectableStops = () => {
	const listing = listBusStops(getServices());
	if (!listing) error(404, 'このサーバーでは、バスの時刻表を使っていません');
	return listing.stops.filter((stop) => stop.id !== UNIVERSITY_STOP.id);
};

export const load: ServerLoad = ({ locals, cookies }) => {
	requireSignedIn(locals);
	return {
		// 一覧は、事業者のコードの順 (函館駅前の側から赤川の側へ、ほぼ路線の順に並ぶ)
		stops: selectableStops()
			.map((stop) => ({ id: stop.id, name: stop.name }))
			.toSorted((a, b) => a.id.localeCompare(b.id)),
		selectedStopId: cookies.get(BUS_STOP_COOKIE) ?? null,
	};
};

export const actions: Actions = {
	select: async ({ request, locals, cookies, url }) => {
		requireSignedIn(locals);
		const stopId = (await request.formData()).get('stopId');
		if (typeof stopId !== 'string' || !selectableStops().some((stop) => stop.id === stopId)) {
			return fail(400, { error: '選んだバス停が見つかりません。' });
		}
		cookies.set(BUS_STOP_COOKIE, stopId, {
			path: '/',
			maxAge: ONE_YEAR_S,
			sameSite: 'lax',
			httpOnly: true,
			secure: url.protocol === 'https:',
		});
		redirect(303, '/app/bus');
	},
};
