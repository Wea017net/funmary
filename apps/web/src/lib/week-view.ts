// 週の時間割の見せ方。自動なら、狭い画面では 1 日ずつ、広い画面では 1 週間を並べる。
// 設定は Cookie に置き、サーバーが画面に入れて返す (読み込みの直後に並びが変わらないようにするため)

export type WeekView = 'auto' | 'day' | 'week';

export const WEEK_VIEW_COOKIE = 'fm-week-view';

export const WEEK_VIEWS: readonly WeekView[] = ['auto', 'day', 'week'];

/** Cookie の値を読む。知らない値は、自動にする */
export function parseWeekView(value: string | undefined): WeekView {
	return value === 'day' || value === 'week' ? value : 'auto';
}
