// バスの画面の状態。選んだ停留所と日の種類を Cookie に置き、サーバーが画面に入れて返す (週の時間割の見せ方と同じ作り)。
// 向きは Cookie に残さず、学内の Wi-Fi と現在地から決める
import type { BusDayType } from '@funmary/core';

/** 選んだ停留所 (サーバーだけが読み書きする) */
export const BUS_STOP_COOKIE = 'fm_bus_stop';

/** 選んだ日の種類 (平日か休日)。その日のうちだけ覚える */
export const BUS_DAY_COOKIE = 'fm-bus-day';

/** Cookie の値を読む。知らない値は null (今日の種類にする) */
export function parseBusDay(value: string | undefined): BusDayType | null {
	return value === 'weekday' || value === 'holiday' ? value : null;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 日本時間の次の 0 時までの秒数。日の種類の Cookie の寿命にする。
 * 土曜に「休日」を選んだまま、月曜に開いても休日の時刻表が出てしまうのを防ぐ
 */
export function secondsUntilJstMidnight(now: Date): number {
	const sinceMidnight = (now.getTime() + JST_OFFSET_MS) % DAY_MS;
	return Math.ceil((DAY_MS - sinceMidnight) / 1000);
}
