// 予定の画面に出す表記 (Issue #144)。ical.js は読み込まない。
import type { EventTime, Recurrence } from '@funmary/core';

const WEEKDAY_NAMES = ['', '月', '火', '水', '木', '金', '土', '日'];

/** 例: "毎週 月、水"、"2 週ごと 金"、"毎月 第 2 火曜日、5 回まで" */
export function describeRecurrence(recurrence: Recurrence): string {
	const every = (unit: string, plural: string) =>
		recurrence.interval === 1 ? `毎${unit}` : `${recurrence.interval} ${plural}ごと`;
	let text: string;
	switch (recurrence.freq) {
		case 'daily':
			text = every('日', '日');
			break;
		case 'yearly':
			text = every('年', '年');
			break;
		case 'weekly':
			text = `${every('週', '週')} ${recurrence.weekdays.map((weekday) => WEEKDAY_NAMES[weekday]).join('、')}`;
			break;
		case 'monthly': {
			const base = every('月', 'か月');
			if (recurrence.monthly.by === 'day') {
				text = recurrence.interval === 1 ? '毎月 (開始日と同じ日)' : `${base} (開始日と同じ日)`;
			} else {
				const { nth, weekday } = recurrence.monthly;
				text = `${base} ${nth === -1 ? '最終' : `第 ${nth} `}${WEEKDAY_NAMES[weekday]}曜日`;
			}
			break;
		}
	}
	if (recurrence.end.kind === 'count') text += `、${recurrence.end.count} 回まで`;
	if (recurrence.end.kind === 'until') text += `、${recurrence.end.date.replaceAll('-', '/')} まで`;
	return text;
}

/** 例: "終日"、"18:00-19:30"、"2 限から 3 限" */
export function formatEventTime(time: EventTime): string {
	if (time.kind === 'allDay') return '終日';
	if (time.kind === 'time') return `${time.start}-${time.end}`;
	return time.from === time.to ? `${time.from} 限` : `${time.from} 限から ${time.to} 限`;
}
