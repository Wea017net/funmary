// 予定のまとめ (Issue #207)。今日か明日の授業と予定を、利用者が選んだ時刻に Discord へ送る。
// ここでは、いつ、どの日の分を送るかだけを決める。I/O は持たず、現在時刻は引数で受け取る。
import { addDays, type CalendarDate } from './calendar-date.ts';

/** evening: 前日の 20:30 に明日の分。morning: 当日の 06:30 に今日の分。custom: 利用者が時刻と日を選ぶ */
export type DailyDigestTiming = 'evening' | 'morning' | 'custom';
export type DailyDigestDay = 'today' | 'tomorrow';

export interface DailyDigestSettings {
	readonly enabled: boolean;
	readonly timing: DailyDigestTiming;
	/** timing が custom のときの、5 分刻みの "HH:MM" (日本時間) */
	readonly customTime: string;
	readonly customDay: DailyDigestDay;
	/** 授業も予定もない日にも、「予定はありません」と送る */
	readonly sendWhenEmpty: boolean;
}

/** Discord と連携した利用者は、設定を変えなければ、前日の夜に送る (作者の判断) */
export const DEFAULT_DAILY_DIGEST_SETTINGS: DailyDigestSettings = {
	enabled: true,
	timing: 'evening',
	customTime: '20:30',
	customDay: 'tomorrow',
	sendWhenEmpty: true,
};

/** 送る処理を動かす間隔。カスタムの時刻もこの刻みで選ぶ */
export const DAILY_DIGEST_STEP_MINUTES = 5;

/** プロセスの再起動などで送る時刻を逃したとき、遅れて送ってよい時間 */
const CATCH_UP_MINUTES = 2 * 60;

export function digestSchedule(settings: DailyDigestSettings): {
	time: string;
	day: DailyDigestDay;
} {
	switch (settings.timing) {
		case 'evening':
			return { time: '20:30', day: 'tomorrow' };
		case 'morning':
			return { time: '06:30', day: 'today' };
		case 'custom':
			return { time: settings.customTime, day: settings.customDay };
	}
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/**
 * いま送るべきなら、まとめる日を返す。lastSentFor は、前に送ったまとめの対象の日。
 * 対象の日で重複を防ぐので、送る時刻を前日と当日の間で切り替えても、同じ日の分は 2 回届かない
 */
export function dueDailyDigest(
	settings: DailyDigestSettings,
	now: { readonly date: CalendarDate; readonly time: string },
	lastSentFor: CalendarDate | null,
): { date: CalendarDate } | null {
	if (!settings.enabled) return null;
	const { time, day } = digestSchedule(settings);
	const elapsed = minutesOf(now.time) - minutesOf(time);
	// 取り戻す時間が日付をまたぐと、対象の日がずれるので、その日のうちに限る
	if (elapsed < 0 || elapsed >= CATCH_UP_MINUTES) return null;
	const date = day === 'today' ? now.date : addDays(now.date, 1);
	return date === lastSentFor ? null : { date };
}

/** 5 分刻みの "HH:MM" か */
export function isDigestTime(value: string): boolean {
	const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
	return match !== null && Number(match[2]) % DAILY_DIGEST_STEP_MINUTES === 0;
}
