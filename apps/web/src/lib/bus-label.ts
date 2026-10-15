// バスの画面に出す文言の組み立て。

/** 時刻表を最後に確かめてから、この日数を超えたら、古いかもしれないと知らせる (取り込みは毎日動く) */
export const BUS_STALE_AFTER_DAYS = 3;

/** 発車までの時間の書き方。例: まもなく、あと 5 分、あと 2 時間 15 分 */
export function formatMinutesUntil(minutes: number): string {
	if (minutes <= 0) return 'まもなく';
	if (minutes < 60) return `あと ${minutes} 分`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 ? `あと ${hours} 時間` : `あと ${hours} 時間 ${rest} 分`;
}

export function isBusDataStale(checkedAt: string | null, now: Date): boolean {
	if (checkedAt === null) return false;
	return now.getTime() - new Date(checkedAt).getTime() > BUS_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}
