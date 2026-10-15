// アクセストークンから、自分の履修登録と、自分だけの曜日と時限、科目の略称を書き換える。
// 公開 API (REST) と MCP が同じ関数を呼ぶ。検査は、画面のフォームと同じもの (@funmary/core) を通す。
// 共有の枠 (ほかの利用者の時間割にも効くもの) と、科目そのものは、ここからは書き込めない。
// 書き込みは、どのトークンからかを、利用者が見られる履歴に残す。
import {
	canViewSubject,
	jstDateTime,
	parseAbbreviation,
	parseSlotInput,
	academicYearOf,
} from '@funmary/core';
import type {
	AccessGrantStore,
	ApiActivityStore,
	AuthStore,
	CourseStore,
	PersonalSlotStore,
	StoredSubject,
	SubjectAbbreviationStore,
	SubjectStore,
} from '@funmary/db';
import type { WriteActor } from './events.ts';

export interface CourseWriteSources {
	readonly subjects: Pick<SubjectStore, 'findBySyllabus' | 'list'>;
	readonly accessGrants: Pick<AccessGrantStore, 'isGranted'>;
	readonly users: Pick<AuthStore, 'findUserById'>;
	readonly courses: Pick<CourseStore, 'register' | 'unregister' | 'isRegistered'>;
	readonly personalSlots: Pick<PersonalSlotStore, 'set' | 'remove' | 'listForSubject'>;
	readonly subjectAbbreviations: Pick<SubjectAbbreviationStore, 'get' | 'set'>;
	readonly activity: Pick<ApiActivityStore, 'record'>;
}

/** 科目の指し方。年度とシラバスの番号か、名前 (年度を省くと、今日が属する年度) */
export type SubjectRef =
	| { readonly academicYear: number; readonly syllabusId: string }
	| { readonly name: string; readonly academicYear?: number | undefined };

export interface CourseSummary {
	readonly academicYear: number;
	readonly syllabusId: string;
	readonly name: string;
	readonly teacher: string | null;
	readonly credits: number | null;
	readonly term: string;
}

/** 書き込んだあとの、その科目の自分の状態。エージェントが、利用者に報告できるように返す */
export interface CourseState {
	readonly subject: CourseSummary;
	readonly registered: boolean;
	readonly personalSlots: readonly {
		readonly weekday: number;
		readonly period: number;
		readonly room: string | null;
	}[];
	/** 保存した略称。保存していなければ null、正式名称に戻す指定なら空文字 */
	readonly abbreviation: string | null;
}

export type CourseWriteFailure =
	| { readonly ok: false; readonly kind: 'invalid'; readonly error: string }
	| { readonly ok: false; readonly kind: 'not_found'; readonly error: string }
	| { readonly ok: false; readonly kind: 'not_registered'; readonly error: string }
	| {
			readonly ok: false;
			readonly kind: 'ambiguous';
			readonly error: string;
			readonly candidates: readonly CourseSummary[];
	  };

export type CourseWriteResult =
	{ readonly ok: true; readonly course: CourseState } | CourseWriteFailure;

/** 名前で指して、当たった科目が多いときに返す候補の数 */
const MAX_CANDIDATES = 10;

const NOT_FOUND: CourseWriteFailure = {
	ok: false,
	kind: 'not_found',
	error: '科目が見つかりません',
};

const toSummary = (subject: StoredSubject): CourseSummary => ({
	academicYear: subject.academicYear,
	syllabusId: subject.syllabusId,
	name: subject.name,
	teacher: subject.teacher,
	credits: subject.credits,
	term: subject.term,
});

type Resolved = { readonly ok: true; readonly subject: StoredSubject } | CourseWriteFailure;

/** 利用者が見られる科目だけを対象にする (ほかの人の非公開の科目は、見つからないことにする) */
function resolveSubject(
	sources: CourseWriteSources,
	userId: string,
	ref: SubjectRef,
	now: Date,
): Resolved {
	const viewer = sources.users.findUserById(userId);
	if (!viewer) return NOT_FOUND;
	const visible = (subject: StoredSubject) => {
		const granted =
			subject.source === 'user' &&
			subject.visibility === 'private' &&
			sources.accessGrants.isGranted('subject', subject.id, viewer.email);
		return canViewSubject(subject, viewer, granted);
	};

	if ('syllabusId' in ref) {
		const subject = sources.subjects.findBySyllabus(ref.academicYear, ref.syllabusId);
		return subject && visible(subject) ? { ok: true, subject } : NOT_FOUND;
	}

	const needle = ref.name.trim().toLowerCase();
	if (needle === '') return NOT_FOUND;
	const year = ref.academicYear ?? academicYearOf(jstDateTime(now).date);
	const viewable = sources.subjects.list(year).filter(visible);
	const exact = viewable.filter((subject) => subject.name.trim().toLowerCase() === needle);
	const matched =
		exact.length > 0
			? exact
			: viewable.filter((subject) => subject.name.toLowerCase().includes(needle));
	const [only] = matched;
	if (matched.length === 1 && only) return { ok: true, subject: only };
	if (matched.length === 0) return NOT_FOUND;
	return {
		ok: false,
		kind: 'ambiguous',
		error: `「${ref.name}」に当たる科目が ${matched.length} 件あります。年度とシラバスの番号で指してください`,
		candidates: matched
			.toSorted((a, b) => a.syllabusId.localeCompare(b.syllabusId))
			.slice(0, MAX_CANDIDATES)
			.map(toSummary),
	};
}

function stateOf(sources: CourseWriteSources, userId: string, subject: StoredSubject): CourseState {
	return {
		subject: toSummary(subject),
		registered: sources.courses.isRegistered(userId, subject.id),
		personalSlots: sources.personalSlots.listForSubject(userId, subject.id),
		abbreviation: sources.subjectAbbreviations.get(userId, subject.id) ?? null,
	};
}

/** 履修登録する。登録済みなら、何も変えず、履歴にも残さない */
export function registerCourse(
	sources: CourseWriteSources,
	actor: WriteActor,
	ref: SubjectRef,
	now: Date,
): CourseWriteResult {
	const resolved = resolveSubject(sources, actor.userId, ref, now);
	if (!resolved.ok) return resolved;
	const { subject } = resolved;
	if (sources.courses.register(actor.userId, subject.id, now)) {
		sources.activity.record(
			{
				...actor,
				action: 'course.register',
				targetId: subject.id,
				summary: `履修科目に「${subject.name}」を登録した`,
			},
			now,
		);
	}
	return { ok: true, course: stateOf(sources, actor.userId, subject) };
}

/** 履修登録を取り消す。自分だけの曜日と時限と略称は残るので、登録し直せば元に戻る */
export function unregisterCourse(
	sources: CourseWriteSources,
	actor: WriteActor,
	ref: SubjectRef,
	now: Date,
): CourseWriteResult {
	const resolved = resolveSubject(sources, actor.userId, ref, now);
	if (!resolved.ok) return resolved;
	const { subject } = resolved;
	if (!sources.courses.unregister(actor.userId, subject.id)) {
		return { ok: false, kind: 'not_found', error: 'この科目は履修科目に登録されていません' };
	}
	sources.activity.record(
		{
			...actor,
			action: 'course.unregister',
			targetId: subject.id,
			summary: `履修科目から「${subject.name}」を外した`,
		},
		now,
	);
	return { ok: true, course: stateOf(sources, actor.userId, subject) };
}

/** 自分だけに使う曜日と時限を足す。同じ曜日と時限があれば、教室を上書きする */
export function setPersonalSlot(
	sources: CourseWriteSources,
	actor: WriteActor,
	ref: SubjectRef,
	slot: { readonly weekday: unknown; readonly period: unknown; readonly room?: unknown },
	now: Date,
): CourseWriteResult {
	const resolved = resolveSubject(sources, actor.userId, ref, now);
	if (!resolved.ok) return resolved;
	const { subject } = resolved;
	const parsed = parseSlotInput(slot);
	if (!parsed.ok) return { ok: false, kind: 'invalid', error: parsed.error };
	if (!sources.courses.isRegistered(actor.userId, subject.id)) {
		return {
			ok: false,
			kind: 'not_registered',
			error: '履修科目に登録した科目だけ、曜日と時限を登録できます',
		};
	}
	sources.personalSlots.set(actor.userId, subject.id, parsed.value, now);
	sources.activity.record(
		{
			...actor,
			action: 'course.personalSlot.set',
			targetId: subject.id,
			summary: `「${subject.name}」に、自分だけの曜日と時限を登録した`,
		},
		now,
	);
	return { ok: true, course: stateOf(sources, actor.userId, subject) };
}

/** 自分だけの曜日と時限を消す */
export function removePersonalSlot(
	sources: CourseWriteSources,
	actor: WriteActor,
	ref: SubjectRef,
	weekday: number,
	period: number,
	now: Date,
): CourseWriteResult {
	const resolved = resolveSubject(sources, actor.userId, ref, now);
	if (!resolved.ok) return resolved;
	const { subject } = resolved;
	if (!sources.personalSlots.remove(actor.userId, subject.id, weekday, period)) {
		return { ok: false, kind: 'not_found', error: 'その曜日と時限は、登録されていません' };
	}
	sources.activity.record(
		{
			...actor,
			action: 'course.personalSlot.remove',
			targetId: subject.id,
			summary: `「${subject.name}」の、自分だけの曜日と時限を消した`,
		},
		now,
	);
	return { ok: true, course: stateOf(sources, actor.userId, subject) };
}

/** 時間割のセルに出す略称を保存する。空にすると、正式名称を使う指定になる */
export function setAbbreviation(
	sources: CourseWriteSources,
	actor: WriteActor,
	ref: SubjectRef,
	abbreviation: unknown,
	now: Date,
): CourseWriteResult {
	const resolved = resolveSubject(sources, actor.userId, ref, now);
	if (!resolved.ok) return resolved;
	const { subject } = resolved;
	const parsed = parseAbbreviation(abbreviation);
	if (!parsed.ok) return { ok: false, kind: 'invalid', error: parsed.error };
	sources.subjectAbbreviations.set(actor.userId, subject.id, parsed.value, now);
	sources.activity.record(
		{
			...actor,
			action: 'course.abbreviation',
			targetId: subject.id,
			summary: `「${subject.name}」の略称を保存した`,
		},
		now,
	);
	return { ok: true, course: stateOf(sources, actor.userId, subject) };
}
