// 利用者の時間割 (設計書 11.2)。DB から、履修科目、学期、祝日、振替授業日、休講などを集めて expandTimetable に渡す。
// 今日の画面 (/) と週の画面 (/week) が使う。
import {
	academicYearOf,
	expandTimetable,
	isTerm,
	resolveAcademicTerms,
	resolveHolidays,
	type CalendarDate,
	type ClassChange,
	type Registration,
	type Slot,
	type Weekday,
} from '@funmary/core';
import type {
	AcademicCalendarStore,
	ClassChangeStore,
	CourseStore,
	HolidayStore,
	SubjectStore,
} from '@funmary/db';

export interface TimetableSources {
	readonly courses: Pick<CourseStore, 'listRegistrations' | 'slotsOf'>;
	readonly subjects: Pick<SubjectStore, 'findById'>;
	readonly classChanges: Pick<ClassChangeStore, 'listAssignedBetween'>;
	readonly academicCalendar: Pick<
		AcademicCalendarStore,
		'listTerms' | 'listSubstituteDays' | 'listNoClassDays'
	>;
	readonly holidays: Pick<HolidayStore, 'list'>;
	/** 内閣府の CSV にまだ載っていない年の祝日の推定 */
	readonly estimateHolidays: (year: number) => readonly { date: CalendarDate; name: string }[];
}

export interface TimetableLesson {
	readonly date: CalendarDate;
	readonly period: number;
	readonly subjectId: number;
	readonly subjectName: string;
	readonly room: string | null;
	/** 補講の教室が分からず、ふだんの教室を仮に出しているとき true */
	readonly roomIsTentative: boolean;
	readonly status: 'normal' | 'cancelled' | 'makeup' | 'roomChanged';
}

/** 授業の有無に関わる、その日の事情。画面で日付の横に出す */
export type DayNote =
	| { readonly kind: 'substitute'; readonly weekday: Weekday }
	| { readonly kind: 'noClass'; readonly label: string | null }
	| { readonly kind: 'holiday'; readonly name: string };

export interface UserTimetable {
	readonly lessons: readonly TimetableLesson[];
	readonly notes: ReadonlyMap<CalendarDate, DayNote>;
	/** 期間に掛かる履修科目の学期の期間に、規則で推定した値を使った */
	readonly usesEstimatedTerms: boolean;
}

const isWeekday = (value: number): value is Weekday =>
	Number.isInteger(value) && value >= 1 && value <= 7;

/** start から end まで (両端を含む) の、利用者の授業 */
export function buildUserTimetable(
	sources: TimetableSources,
	userId: string,
	range: { readonly start: CalendarDate; readonly end: CalendarDate },
): UserTimetable {
	const notes = dayNotes(sources, range);
	// 全学の休講日は、祝日と同じく授業のない日として渡す
	const noClassDates = [...notes].flatMap(([date, note]) =>
		note.kind === 'noClass' ? [date] : [],
	);
	const holidayDates = [...notes].flatMap(([date, note]) =>
		note.kind === 'holiday' ? [date] : [],
	);
	const substituteDays = [...notes].flatMap(([date, note]) =>
		note.kind === 'substitute' ? [{ date, weekday: note.weekday }] : [],
	);

	const subjects = sources.courses.listRegistrations(userId).flatMap(({ subjectId }) => {
		const subject = sources.subjects.findById(subjectId);
		return subject && isTerm(subject.term) ? [{ ...subject, term: subject.term }] : [];
	});
	const changes = sources.classChanges.listAssignedBetween(range.start, range.end);

	const lessons: TimetableLesson[] = [];
	let usesEstimatedTerms = false;
	// 科目は年度ごとにあるので、期間が年度をまたぐときは、年度ごとに分けて展開する
	for (const year of yearsIn(range)) {
		const yearRange = {
			start: maxDate(range.start, `${year}-04-01`),
			end: minDate(range.end, `${year + 1}-03-31`),
		};
		const ofYear = subjects.filter((subject) => subject.academicYear === year);
		if (ofYear.length === 0) continue;
		const terms = resolveAcademicTerms(year, sources.academicCalendar.listTerms(year));
		// 推定の値が期間に掛かるときだけ数える (期間の外の学期の値は、授業の有無に関わらない)
		usesEstimatedTerms ||= ofYear.some((subject) =>
			terms.some(
				(term) =>
					term.term === subject.term &&
					term.source === 'estimated' &&
					term.start <= yearRange.end &&
					yearRange.start <= term.end,
			),
		);
		const registrations: Registration[] = ofYear.map((subject) => ({
			subjectId: String(subject.id),
			term: subject.term,
			slots: sources.courses
				.slotsOf(subject.id)
				.flatMap((slot): Slot[] =>
					isWeekday(slot.weekday)
						? [{ weekday: slot.weekday, period: slot.period, room: slot.room }]
						: [],
				),
		}));
		const expanded = expandTimetable({
			range: yearRange,
			terms,
			registrations,
			holidays: [...holidayDates, ...noClassDates],
			substituteDays,
			classChanges: changes.map(toClassChange),
		});
		const names = new Map(ofYear.map((subject) => [String(subject.id), subject.name]));
		for (const lesson of expanded) {
			lessons.push({
				...lesson,
				subjectId: Number(lesson.subjectId),
				subjectName: names.get(lesson.subjectId) ?? '',
			});
		}
	}
	return { lessons, notes, usesEstimatedTerms };
}

/** 振替授業日、全学の休講日、祝日の順に優先して、日付ごとに 1 つだけ残す */
function dayNotes(
	sources: TimetableSources,
	range: { readonly start: CalendarDate; readonly end: CalendarDate },
): Map<CalendarDate, DayNote> {
	const notes = new Map<CalendarDate, DayNote>();
	const holidays = resolveHolidays({
		stored: sources.holidays.list(),
		estimate: sources.estimateHolidays,
		throughYear: Number(range.end.slice(0, 4)),
	});
	for (const holiday of holidays) {
		if (range.start <= holiday.date && holiday.date <= range.end) {
			notes.set(holiday.date, { kind: 'holiday', name: holiday.name });
		}
	}
	for (const day of sources.academicCalendar.listNoClassDays(range.start, range.end)) {
		notes.set(day.date, { kind: 'noClass', label: day.label });
	}
	for (const day of sources.academicCalendar.listSubstituteDays(range.start, range.end)) {
		// 全学の休講日と重なったら、授業はない
		if (notes.get(day.date)?.kind === 'noClass') continue;
		notes.set(day.date, { kind: 'substitute', weekday: day.weekday });
	}
	return notes;
}

function toClassChange(change: {
	readonly kind: ClassChange['kind'];
	readonly subjectId: number;
	readonly date: CalendarDate;
	readonly period: number;
	readonly room: string | null;
}): ClassChange {
	const base = { subjectId: String(change.subjectId), date: change.date, period: change.period };
	switch (change.kind) {
		case 'cancellation':
			return { kind: 'cancellation', ...base };
		case 'makeup':
			return { kind: 'makeup', ...base, room: change.room };
		case 'roomChange':
			return { kind: 'roomChange', ...base, room: change.room };
	}
}

function yearsIn(range: { readonly start: CalendarDate; readonly end: CalendarDate }): number[] {
	const years: number[] = [];
	for (let year = academicYearOf(range.start); year <= academicYearOf(range.end); year++) {
		years.push(year);
	}
	return years;
}

const maxDate = (a: CalendarDate, b: CalendarDate) => (a < b ? b : a);
const minDate = (a: CalendarDate, b: CalendarDate) => (a < b ? a : b);
