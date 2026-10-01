// 予定のまとめ (#207) の文面。今日か明日の授業と予定を、Discord のメッセージ 1 通にする。
// メンションは送信の側 (allowed_mentions) で止めるので、ここでは書式に効く記号だけをただの文字にする。
import {
	DEFAULT_PERIODS,
	findPeriod,
	type CalendarDate,
	type DailyDigestTiming,
} from '@funmary/core';
import { formatPeriod } from '$lib/period-label.ts';
import { formatDate, formatDayNote, STATUS_LABELS } from '$lib/timetable-label.ts';
import type { SendDailyDigestDeps } from '@funmary/jobs';
import { DiscordApiError, type DiscordBot } from '@funmary/notify';
import { eventsOnDate, type EventView } from './event-view.ts';
import type { Services } from './services.ts';
import { buildUserTimetable, type DayNote, type TimetableLesson } from './user-timetable.ts';

export interface DailyDigestContent {
	readonly date: CalendarDate;
	readonly timing: DailyDigestTiming;
	readonly lessons: readonly TimetableLesson[];
	readonly note: DayNote | null;
	readonly events: readonly Pick<EventView, 'time' | 'title' | 'location'>[];
	/** その日を開いた週の画面の URL */
	readonly weekUrl: string;
}

/** Discord の Markdown として効く記号の前に \ を置く */
function plain(text: string): string {
	return text.replace(/[\\*_`~|>#[\]()-]/g, (char) => `\\${char}`);
}

function opening(timing: DailyDigestTiming, date: CalendarDate, empty: boolean): string {
	const day = formatDate(date);
	const tail = empty ? `に予定はありません。` : `の予定です。`;
	switch (timing) {
		case 'evening':
			return `今日も一日お疲れ様です。明日 ${day} ${tail}`;
		case 'morning':
			return `おはようございます。今日 ${day} ${tail}`;
		case 'custom':
			// 送る時刻が利用者しだいなので、時間帯に依らない挨拶にする
			return `お疲れ様です。${day} ${tail}`;
	}
}

function lessonLine(lesson: TimetableLesson): string {
	const period = findPeriod(lesson.period, DEFAULT_PERIODS);
	const when = period ? formatPeriod(period) : `${lesson.period} 限`;
	const name =
		lesson.status === 'cancelled' ? `~~${plain(lesson.subjectName)}~~` : plain(lesson.subjectName);
	const room =
		lesson.status === 'cancelled'
			? ''
			: lesson.room === null
				? ' (教室未定)'
				: ` (${plain(lesson.room)}${lesson.roomIsTentative ? '、仮。ふだんの教室' : ''})`;
	const status = lesson.status === 'normal' ? '' : ` [${STATUS_LABELS[lesson.status]}]`;
	return `${when} ${name}${room}${status}`;
}

export function composeDailyDigest(content: DailyDigestContent): string {
	const lessons = [...content.lessons].sort((a, b) => a.period - b.period);
	const empty = lessons.length === 0 && content.events.length === 0;
	const lines = [opening(content.timing, content.date, empty)];
	if (content.note) lines.push(plain(formatDayNote(content.note)));
	if (lessons.length > 0) lines.push('', '**授業**', ...lessons.map(lessonLine));
	if (content.events.length > 0) {
		lines.push(
			'',
			'**予定**',
			...content.events.map(
				(event) =>
					`${event.time} ${plain(event.title)}${event.location ? ` (${plain(event.location)})` : ''}`,
			),
		);
	}
	// <> で囲むと、Discord がリンクの埋め込み (プレビュー) を出さない
	lines.push('', `<${content.weekUrl}>`);
	return lines.join('\n');
}

/** 定期処理 (send-daily-digest) に渡す、DB と Discord への接続。管理者が Discord 連携を止めている間は、だれにも送らない */
export function dailyDigestDeps(services: () => Services, bot: DiscordBot): SendDailyDigestDeps {
	return {
		listTargets: () => {
			const current = services();
			return current.discord.link.enabled() ? current.dailyDigest.listRecipients() : [];
		},
		compose: (userId, date, timing) => {
			const current = services();
			const timetable = buildUserTimetable(current, userId, { start: date, end: date });
			const user = current.auth.findUserById(userId);
			const added = user ? current.userEvents.listSubscribed(user) : [];
			const lessons = timetable.lessons.filter((lesson) => lesson.date === date);
			const events = eventsOnDate([...current.userEvents.listByOwner(userId), ...added], date);
			const text = composeDailyDigest({
				date,
				timing,
				lessons,
				note: timetable.notes.get(date) ?? null,
				events,
				weekUrl: `${current.origin}/app/week?date=${date}`,
			});
			return { text, empty: lessons.length === 0 && events.length === 0 };
		},
		send: async (channelId, text) => {
			try {
				await bot.postMessage(channelId, text);
				return 'sent';
			} catch (error) {
				// スレッドや DM が消えた、相手が DM を拒否したなど、送り直しても届かない
				if (error instanceof DiscordApiError && (error.status === 403 || error.status === 404)) {
					return 'gone';
				}
				throw error;
			}
		},
		markSent: (userId, date, now) => services().dailyDigest.markSent(userId, date, now),
	};
}
