// バスの画面とホームが、同じバス停と向きを選ぶための部品
import { DEFAULT_BUS_STOP_IDS, isInIpRanges, type BusDirection } from '@funmary/core';

/** 覚えているバス停が選べるならそれを、なければ既定のバス停、それもなければ一覧の先頭を使う */
export function chooseBusStopId(
	savedId: string | undefined,
	selectableIds: readonly string[],
): string | null {
	const known = (id: string | undefined): id is string =>
		id !== undefined && selectableIds.includes(id);
	return (
		(known(savedId) && savedId) ||
		DEFAULT_BUS_STOP_IDS.find((id) => known(id)) ||
		selectableIds[0] ||
		null
	);
}

/**
 * はじめの向き。学内の Wi-Fi (接続元が範囲に入る) なら未来大から出る向き、そうでなければ未来大へ向かう向き。
 * 接続元を読めないときは、学内でないものとして扱う
 */
export function defaultBusDirection(
	getClientAddress: () => string,
	campusRanges: readonly string[],
): { direction: BusDirection; onCampus: boolean } {
	let onCampus = false;
	if (campusRanges.length > 0) {
		try {
			onCampus = isInIpRanges(getClientAddress(), campusRanges);
		} catch {
			onCampus = false;
		}
	}
	return { direction: onCampus ? 'fromUniversity' : 'toUniversity', onCampus };
}
