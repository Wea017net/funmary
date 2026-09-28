// カレンダー購読の ICS に載せる予定 (設計書 13 章)。トークンの持ち主の時間割を、Hono の ICS の組み立てに渡す形にする。
import type { CalendarFeed } from '@funmary/api';
import { addDays, jstDateTime } from '@funmary/core';
import type { FeedTokenStore } from '@funmary/db';
import { formatDayNote } from '$lib/timetable-label.ts';
import { toLessonView } from './lesson-view.ts';
import { buildUserTimetable, type TimetableSources } from './user-timetable.ts';

/** 載せる期間。過去の授業も少し残し、履修を登録した次の学期の分まで届くようにする */
const DAYS_BEFORE = 14;
const DAYS_AFTER = 182;

export interface CalendarFeedSources extends TimetableSources {
	readonly feedTokens: Pick<FeedTokenStore, 'findOwner' | 'markUsed'>;
	/** 公開 URL の origin。授業の詳細画面の URL に使う */
	readonly origin: string;
}

const httpsOnly = (url: string | null) => (url?.startsWith('https://') ? url : null);

/** トークンの持ち主の予定。知らないトークン、取り消したトークン、停止した利用者なら null */
export function loadCalendarFeed(
	sources: CalendarFeedSources,
	token: string,
	now: Date,
): { feed: CalendarFeed; stamp: Date } | null {
	const owner = sources.feedTokens.findOwner('calendar', token);
	if (!owner) return null;
	sources.feedTokens.markUsed(owner.id, now);

	const today = jstDateTime(now).date;
	const timetable = buildUserTimetable(sources, owner.userId, {
		start: addDays(today, -DAYS_BEFORE),
		end: addDays(today, DAYS_AFTER),
	});
	const lessons = timetable.lessons.map((lesson) => {
		const view = toLessonView(lesson);
		const subject = sources.subjects.findById(lesson.subjectId);
		return {
			date: view.date,
			period: view.period,
			start: view.start,
			end: view.end,
			subjectKey: `${view.subjectPath.year}-${view.subjectPath.code}`,
			subjectName: view.subjectName,
			teacher: subject?.teacher ?? null,
			room: view.room,
			roomIsTentative: view.roomIsTentative,
			status: view.status,
			detailUrl: `${sources.origin}/app/subjects/${view.subjectPath.year}/${encodeURIComponent(view.subjectPath.code)}`,
			syllabusUrl: httpsOnly(subject?.syllabusUrl ?? null),
		};
	});
	// 祝日は、たいていのカレンダーアプリが自分で出すので載せない
	const days = [...timetable.notes]
		.filter(([, note]) => note.kind !== 'holiday')
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, note]) => ({
			date,
			summary:
				note.kind === 'substitute' ? `振替授業日 (${formatDayNote(note)})` : formatDayNote(note),
		}));
	return {
		feed: { lessons, days },
		// 同じ日のうちは同じ内容になり、ETag で 304 を返せるようにする
		stamp: new Date(`${today}T00:00:00+09:00`),
	};
}
