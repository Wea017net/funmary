// 画面、通知、Discord の文面が共有する、日本語の呼び名。各所で同じ表を持つと、食い違うので、ここに 1 つだけ置く。

/** 曜日の名前。添字は ISO の曜日 (1 が月曜から 7 が日曜)。0 番は使わない */
export const WEEKDAY_NAMES: readonly string[] = ['', '月', '火', '水', '木', '金', '土', '日'];

/** 休講、補講、教室変更の呼び名 */
export const CLASS_CHANGE_KIND_LABELS = {
	cancellation: '休講',
	makeup: '補講',
	roomChange: '教室変更',
} as const;
