// 取得元の状態の表示名 (管理画面と管理用コマンドで共有する)
export type SourceState = 'ok' | 'failing' | 'unhealthy' | 'never';

export const SOURCE_STATE_LABELS: Record<SourceState, string> = {
	ok: '正常',
	failing: '失敗あり',
	unhealthy: '不調',
	never: 'まだ動いていません',
};
