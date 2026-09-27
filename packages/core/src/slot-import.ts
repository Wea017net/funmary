// 授業時間割 (大学が学期ごとに配る PDF) のコマを、科目と照合して、科目ごとに共有する枠にする。
// 公開シラバスの科目名は「科目名 + クラス」の形 (例: 余暇と健康Ⅱ1-EF) なので、時間割の科目名とクラスをつなげて照合する。
// 誤った科目に枠を付けると、別の授業の時間割を出してしまうので、決められない名前と、似た名前でしか合わない名前は枠にせず、人の確認へ回す。
import { matchLessonName, type MatchResult, type SubjectName } from './lesson-matching.ts';
import type { Term } from './timetable.ts';

/** 時間割の表の 1 つのコマ。@funmary/sources の TimetablePdfEntry と同じ形 */
export interface TimetableCell {
	/** 1 が月曜 */
	readonly weekday: number;
	readonly period: number;
	/** 科目名 (教員や注記を除いたもの) */
	readonly subject: string;
	/** クラス (例: 1-AB、1～4)。書かれていなければ null */
	readonly classes: string | null;
	readonly rooms: readonly string[];
}

export interface PlannedSlot {
	readonly subjectId: number;
	readonly weekday: number;
	readonly period: number;
	/** 部屋を , でつないだもの。書かれていなければ null */
	readonly room: string | null;
	/** 照合に使った名前 (科目名 + クラス) */
	readonly lessonName: string;
	readonly method: Exclude<Extract<MatchResult, { kind: 'matched' }>['method'], 'similarity'>;
}

/**
 * 枠にしなかった名前。similar は、似た名前の科目 (candidateId) はあるが、同じとは言い切れないもの。
 * 科目名にクラスが付いているので (1-AB と 1-CD など)、似た名前で選ぶと、別のクラスの科目に付けてしまう
 */
export type UnmatchedName =
	| { readonly lessonName: string; readonly reason: 'unmatched' | 'ambiguous' }
	| { readonly lessonName: string; readonly reason: 'similar'; readonly candidateId: number };

export interface SlotImportPlan {
	readonly slots: readonly PlannedSlot[];
	readonly unmatched: readonly UnmatchedName[];
}

const MAX_WEEKDAY = 6;
const MAX_PERIOD = 6;

const SEMESTER_TERMS: Record<'spring' | 'fall', readonly Term[]> = {
	spring: ['full-year', 'spring', 'q1', 'q2'],
	fall: ['full-year', 'fall', 'q3', 'q4'],
};

/**
 * 時間割の学期 (前期か後期) に行われうる科目だけを選ぶ。前期と後期に同じ名前の科目があるので、照合の前に絞る。
 * 学期が分からなければ、すべてを返す
 */
export function subjectsInSemester<T extends { readonly term: string }>(
	subjects: readonly T[],
	semester: 'spring' | 'fall' | null,
): T[] {
	if (semester === null) return [...subjects];
	const terms: readonly string[] = SEMESTER_TERMS[semester];
	return subjects.filter((subject) => terms.includes(subject.term));
}

export function planSlotImport(
	cells: readonly TimetableCell[],
	subjects: readonly SubjectName[],
): SlotImportPlan {
	// 同じ名前は何度も出てくる (週に 2 コマの科目など) ので、照合の結果を使い回す
	const matches = new Map<string, MatchResult>();
	const slots = new Map<string, { slot: PlannedSlot; rooms: string[] }>();
	const unmatched = new Map<string, UnmatchedName>();

	for (const cell of cells) {
		if (!Number.isInteger(cell.weekday) || cell.weekday < 1 || cell.weekday > MAX_WEEKDAY) continue;
		if (!Number.isInteger(cell.period) || cell.period < 1 || cell.period > MAX_PERIOD) continue;

		const lessonName = `${cell.subject}${cell.classes ?? ''}`;
		let match = matches.get(lessonName);
		if (!match) {
			match = matchLessonName(lessonName, subjects);
			matches.set(lessonName, match);
		}
		if (match.kind !== 'matched' || match.method === 'similarity') {
			if (!unmatched.has(lessonName)) {
				unmatched.set(
					lessonName,
					match.kind === 'matched'
						? { lessonName, reason: 'similar', candidateId: match.subjectId }
						: { lessonName, reason: match.kind === 'ambiguous' ? 'ambiguous' : 'unmatched' },
				);
			}
			continue;
		}

		const key = `${match.subjectId}:${cell.weekday}:${cell.period}`;
		const existing = slots.get(key);
		if (existing) {
			for (const room of cell.rooms) {
				if (!existing.rooms.includes(room)) existing.rooms.push(room);
			}
			continue;
		}
		slots.set(key, {
			slot: {
				subjectId: match.subjectId,
				weekday: cell.weekday,
				period: cell.period,
				room: null,
				lessonName,
				method: match.method,
			},
			rooms: [...new Set(cell.rooms)],
		});
	}

	return {
		slots: [...slots.values()].map(({ slot, rooms }) => ({
			...slot,
			room: rooms.length > 0 ? rooms.join(',') : null,
		})),
		unmatched: [...unmatched.values()],
	};
}
