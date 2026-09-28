// 科目の保存 (設計書 11 章)。科目は、年度とシラバスの番号の組で区別する。
// 公開シラバスから取り込んだもののほか、シラバスにない授業として利用者や管理者が足したもの (source が user) もある。
// 上書きしても、科目の ID は変えない (履修登録、時間割の枠、休講の記録が、この ID を参照しているため)。
import { randomBytes } from 'node:crypto';
import { and, desc, eq, max } from 'drizzle-orm';
import type { Database } from './database.ts';
import { subjects } from './schema.ts';

export interface SubjectInput {
	readonly academicYear: number;
	/** シラバスの番号 (授業コード) */
	readonly syllabusId: string;
	readonly name: string;
	readonly teacher: string | null;
	readonly credits: number | null;
	/** @funmary/core の Term */
	readonly term: string;
	readonly attributes: Record<string, string>;
	readonly syllabus: Record<string, string>;
	readonly syllabusUrl: string | null;
}

export interface StoredSubject extends SubjectInput {
	readonly id: number;
	readonly updatedAt: Date;
	readonly source: 'syllabus' | 'user';
	/** 足した人 (source が user のとき。退会したら null) */
	readonly createdBy: string | null;
}

/** シラバスにない授業として足す科目 */
export interface UserSubjectInput {
	readonly academicYear: number;
	readonly name: string;
	/** @funmary/core の Term */
	readonly term: string;
	readonly teacher: string | null;
}

export interface SubjectStore {
	/** 保存 (同じ年度とシラバスの番号があれば上書き) して、科目の ID を返す */
	upsert(input: SubjectInput, now: Date): number;
	findBySyllabus(academicYear: number, syllabusId: string): StoredSubject | null;
	findById(id: number): StoredSubject | null;
	/** 年度の科目を、名前の順に返す */
	list(academicYear: number): StoredSubject[];
	/** 年度の科目の、シラバスの番号ごとの更新の時刻。詳細を取り直すかの判断に使う */
	updatedAtBySyllabus(academicYear: number): Map<string, Date>;
	/**
	 * シラバスから取り込んだ科目の、最も新しい年度。新年度のシラバスがまだなければ、前年度を使い続けるために使う。
	 * 利用者が先の年度の科目を足しても、年度の判断が変わらないよう、足した科目は数えない
	 */
	latestYear(): number | null;
	/** シラバスにない授業として科目を足し、科目の ID を返す。シラバスの番号は "user-" で始まる乱数にする */
	createUserSubject(input: UserSubjectInput, createdBy: string | null, now: Date): number;
	/** 足した科目の名前、学期、教員を直す。シラバスから取り込んだ科目なら false */
	updateUserSubject(id: number, input: Omit<UserSubjectInput, 'academicYear'>, now: Date): boolean;
	/** 足した科目を消す (履修登録と時間割の枠も消える)。シラバスから取り込んだ科目なら false */
	deleteUserSubject(id: number): boolean;
}

type Row = typeof subjects.$inferSelect;

function toStored(row: Row): StoredSubject {
	return {
		id: row.id,
		academicYear: row.academicYear,
		syllabusId: row.syllabusId,
		name: row.name,
		teacher: row.teacher,
		credits: row.credits,
		term: row.term,
		attributes: row.attributes ?? {},
		syllabus: row.syllabus ?? {},
		syllabusUrl: row.syllabusUrl,
		updatedAt: row.updatedAt,
		source: row.source,
		createdBy: row.createdBy,
	};
}

export function createSubjectStore(database: Database): SubjectStore {
	const { db } = database;
	return {
		upsert(input, now) {
			const values = {
				name: input.name,
				teacher: input.teacher,
				credits: input.credits,
				term: input.term,
				attributes: input.attributes,
				syllabus: input.syllabus,
				syllabusUrl: input.syllabusUrl,
				updatedAt: now,
			};
			const row = db
				.insert(subjects)
				.values({ academicYear: input.academicYear, syllabusId: input.syllabusId, ...values })
				.onConflictDoUpdate({
					target: [subjects.academicYear, subjects.syllabusId],
					set: values,
				})
				.returning({ id: subjects.id })
				.get();
			return row.id;
		},
		findBySyllabus(academicYear, syllabusId) {
			const row = db
				.select()
				.from(subjects)
				.where(and(eq(subjects.academicYear, academicYear), eq(subjects.syllabusId, syllabusId)))
				.get();
			return row ? toStored(row) : null;
		},
		findById(id) {
			const row = db.select().from(subjects).where(eq(subjects.id, id)).get();
			return row ? toStored(row) : null;
		},
		list(academicYear) {
			return db
				.select()
				.from(subjects)
				.where(eq(subjects.academicYear, academicYear))
				.orderBy(subjects.name, desc(subjects.id))
				.all()
				.map(toStored);
		},
		updatedAtBySyllabus(academicYear) {
			const rows = db
				.select({ syllabusId: subjects.syllabusId, updatedAt: subjects.updatedAt })
				.from(subjects)
				.where(eq(subjects.academicYear, academicYear))
				.all();
			return new Map(rows.map((row) => [row.syllabusId, row.updatedAt]));
		},
		latestYear() {
			const row = db
				.select({ year: max(subjects.academicYear) })
				.from(subjects)
				.where(eq(subjects.source, 'syllabus'))
				.get();
			return row?.year ?? null;
		},
		createUserSubject(input, createdBy, now) {
			return db
				.insert(subjects)
				.values({
					academicYear: input.academicYear,
					syllabusId: `user-${randomBytes(9).toString('base64url')}`,
					name: input.name,
					teacher: input.teacher,
					credits: null,
					term: input.term,
					attributes: {},
					syllabus: {},
					syllabusUrl: null,
					updatedAt: now,
					source: 'user',
					createdBy,
				})
				.returning({ id: subjects.id })
				.get().id;
		},
		updateUserSubject(id, input, now) {
			return (
				db
					.update(subjects)
					.set({ name: input.name, term: input.term, teacher: input.teacher, updatedAt: now })
					.where(and(eq(subjects.id, id), eq(subjects.source, 'user')))
					.run().changes > 0
			);
		},
		deleteUserSubject(id) {
			return (
				db
					.delete(subjects)
					.where(and(eq(subjects.id, id), eq(subjects.source, 'user')))
					.run().changes > 0
			);
		},
	};
}
