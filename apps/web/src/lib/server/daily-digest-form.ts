// 予定のまとめ (#207) の設定のフォームを読む。
import { DAILY_DIGEST_STEP_MINUTES, isDigestTime, type DailyDigestSettings } from '@funmary/core';

export type DailyDigestFormResult =
	| { readonly ok: true; readonly settings: DailyDigestSettings }
	| { readonly ok: false; readonly error: string };

const INVALID = '入力が正しくありません。';

/** カスタムでないときは、時刻と日の欄を送らない (画面で無効にする) ので、current の値を残す */
export function parseDailyDigestForm(
	form: FormData,
	current: DailyDigestSettings,
): DailyDigestFormResult {
	const timing = form.get('timing');
	if (timing !== 'evening' && timing !== 'morning' && timing !== 'custom') {
		return { ok: false, error: INVALID };
	}
	let { customTime, customDay } = current;
	if (timing === 'custom') {
		// 時と分を別の選択欄で受け取る (5 分刻みを、画面の側でも守れるように)
		const hour = form.get('customHour');
		const minute = form.get('customMinute');
		const time = typeof hour === 'string' && typeof minute === 'string' ? `${hour}:${minute}` : '';
		const day = form.get('customDay');
		if (!isDigestTime(time)) {
			return { ok: false, error: `時刻は ${DAILY_DIGEST_STEP_MINUTES} 分刻みで選んでください。` };
		}
		if (day !== 'today' && day !== 'tomorrow') return { ok: false, error: INVALID };
		customTime = time;
		customDay = day;
	}
	return {
		ok: true,
		settings: {
			enabled: form.get('enabled') === 'on',
			timing,
			customTime,
			customDay,
			sendWhenEmpty: form.get('sendWhenEmpty') === 'on',
		},
	};
}
