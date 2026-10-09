// Discord のスラッシュコマンドの答え (#36)。呼んだ本人の時間割と休講を、本人にだけ見える本文にする。
// 連携していない人、停止した利用者には、答えの代わりに連携の案内を返す。
import { buildUserTimetable, type DayNote, type TimetableLesson } from '@funmary/api';
import { addDays, findPeriod, DEFAULT_PERIODS, jstDateTime, startOfWeek } from '@funmary/core';
import type { CalendarDate } from '@funmary/core';
import { formatDate, formatDayNote, STATUS_LABELS } from '#lib/timetable-label.ts';
import { plain } from './daily-digest.ts';
import type { Services } from './services.ts';

/** /changes が見る先の日数 */
const CHANGES_DAYS = 14;

const CHANGES_FILTER = (lesson: TimetableLesson) => lesson.status !== 'normal';

function lessonLine(lesson: TimetableLesson): string {
	const period = findPeriod(lesson.period, DEFAULT_PERIODS);
	const when = period ? period.start : `${lesson.period} 限`;
	const room = lesson.room ? ` (${plain(lesson.room)})` : '';
	const status = lesson.status === 'normal' ? '' : ` [${STATUS_LABELS[lesson.status]}]`;
	return `${when} ${plain(lesson.subjectName)}${room}${status}`;
}

/** 日付ごとに、授業を時限の順に並べる。授業のない日は、その事情だけを出す */
function dayBlocks(
	dates: readonly CalendarDate[],
	lessons: readonly TimetableLesson[],
	notes: ReadonlyMap<CalendarDate, DayNote>,
	include: (lesson: TimetableLesson) => boolean,
): string[] {
	return dates.flatMap((date) => {
		const ofDay = lessons
			.filter((lesson) => lesson.date === date && include(lesson))
			.sort((a, b) => a.period - b.period);
		const note = notes.get(date);
		if (ofDay.length === 0 && !note) return [];
		const head = `**${formatDate(date)}**`;
		const body =
			ofDay.length > 0 ? ofDay.map(lessonLine) : note ? [plain(formatDayNote(note))] : [];
		return [head, ...body];
	});
}

function daysFrom(start: CalendarDate, count: number): CalendarDate[] {
	return Array.from({ length: count }, (_, index) => addDays(start, index));
}

/** Discord に送る、連携の案内 (本人にだけ見える) */
function linkGuidance(origin: string): string {
	return `この Discord のアカウントは、まだ Funmary に連携されていません。設定の「Discord 連携」から連携してください: ${origin}/app/settings/discord`;
}

/**
 * コマンドの答え。連携の確認から本文の作成までを行い、本人にだけ見せる文を返す。
 * 例外は握って、案内の文に置き換える (3 秒以内に応答するため、読み取りだけを同期で行う)
 */
export function answerCommand(
	services: Services,
	command: string,
	discordUserId: string,
	now: Date,
): string {
	if (!services.discord.link.enabled()) {
		return 'Discord 連携は、いまは停止しています。';
	}
	const link = services.discord.link.store.findByDiscordUserId(discordUserId);
	if (!link) return linkGuidance(services.origin);
	const user = services.auth.findUserById(link.userId);
	if (!user || user.status !== 'active')
		return 'この Funmary のアカウントは、いまは利用できません。';

	const today = jstDateTime(now).date;
	if (command === 'today') {
		const timetable = buildUserTimetable(services, user.id, { start: today, end: today });
		const body = dayBlocks([today], timetable.lessons, timetable.notes, () => true);
		return body.length > 0 ? body.join('\n') : '今日は、授業も休みの知らせもありません。';
	}
	if (command === 'week') {
		const weekStart = startOfWeek(today);
		const dates = daysFrom(weekStart, 7);
		const timetable = buildUserTimetable(services, user.id, {
			start: weekStart,
			end: addDays(weekStart, 6),
		});
		const body = dayBlocks(dates, timetable.lessons, timetable.notes, () => true);
		return body.length > 0 ? body.join('\n') : 'この週は、授業の予定がありません。';
	}
	if (command === 'changes') {
		const dates = daysFrom(today, CHANGES_DAYS);
		const timetable = buildUserTimetable(services, user.id, {
			start: today,
			end: addDays(today, CHANGES_DAYS - 1),
		});
		const body = dayBlocks(dates, timetable.lessons, timetable.notes, CHANGES_FILTER);
		return body.length > 0
			? body.join('\n')
			: `これから ${CHANGES_DAYS} 日の休講、補講、教室変更はありません。`;
	}
	return 'そのコマンドには対応していません。';
}
