// 現在地から、バスの向きを決める (ブラウザだけで動く)。バスの画面とホームが使う。
// 未来大の近くなら未来大から出る向き、離れていれば未来大へ向かう向き
import { isNearUniversity, type BusDirection } from '@funmary/core';

export type LocateResult =
	| { readonly direction: BusDirection }
	/** 許可されなかったか、現在地を取れなかった */
	| { readonly problem: 'denied' | 'unavailable' };

export function locateBusDirection(): Promise<LocateResult> {
	return new Promise((resolve) => {
		navigator.geolocation.getCurrentPosition(
			({ coords }) =>
				resolve({
					direction: isNearUniversity(coords.latitude, coords.longitude)
						? 'fromUniversity'
						: 'toUniversity',
				}),
			(error) =>
				resolve({ problem: error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable' }),
			{ maximumAge: 60_000, timeout: 10_000 },
		);
	});
}

/** 位置情報が使える端末か */
export const canLocate = () => typeof navigator !== 'undefined' && 'geolocation' in navigator;

/** すでに許可されているか。許可の確認を、勝手には出さないために、自動で決めるのはこのときだけにする */
export async function isLocationGranted(): Promise<boolean> {
	try {
		return (await navigator.permissions?.query({ name: 'geolocation' }))?.state === 'granted';
	} catch {
		return false;
	}
}
