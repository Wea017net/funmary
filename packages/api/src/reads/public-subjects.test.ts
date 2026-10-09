import {
	createAcademicCalendarStore,
	createAccessGrantStore,
	createAuthStore,
	createClassChangeStore,
	createCourseStore,
	createHolidayStore,
	createPersonalSlotStore,
	createSubjectStore,
	type Database,
} from '@funmary/db';
import { describe, expect, it } from 'vitest';
import {
	getSubjectSessions,
	searchSubjects,
	SUBJECT_SEARCH_LIMIT,
	type SubjectSessionSources,
} from './public-subjects.ts';
import { useTestDatabase } from '@funmary/db/testing';

let database: Database;
useTestDatabase('funmary-public-subjects-', (db) => (database = db));

const NOW = new Date('2026-09-27T00:00:00Z');

function sources(): SubjectSessionSources {
	return {
		courses: createCourseStore(database),
		personalSlots: createPersonalSlotStore(database),
		subjects: createSubjectStore(database),
		classChanges: createClassChangeStore(database),
		academicCalendar: createAcademicCalendarStore(database),
		holidays: createHolidayStore(database),
		estimateHolidays: () => [],
		accessGrants: createAccessGrantStore(database),
	};
}

function addSubject(overrides: {
	syllabusId: string;
	name: string;
	teacher?: string | null;
	term?: string;
}) {
	return createSubjectStore(database).upsert(
		{
			academicYear: 2026,
			teacher: null,
			credits: 2,
			term: 'fall',
			attributes: {},
			syllabus: {},
			syllabusUrl: null,
			...overrides,
		},
		NOW,
	);
}

const viewerOf = (id: string) => ({ id, email: `${id}@fun.ac.jp`, role: 'user' as const });

describe('searchSubjects', () => {
	it('名前、教員、授業コードで探す。大文字と小文字、前後の空白は区別しない', () => {
		addSubject({ syllabusId: '100001', name: '架空の代数', teacher: '架空 太郎' });
		addSubject({ syllabusId: '100002', name: 'Fictional English', teacher: '架空 花子' });
		addSubject({ syllabusId: '200003', name: '架空の物理' });

		const find = (q: string) =>
			searchSubjects(
				{ subjects: createSubjectStore(database) },
				{ academicYear: 2026, q },
			).subjects.map((s) => s.syllabusId);

		expect(find('代数')).toEqual(['100001']);
		expect(find('  fictional ')).toEqual(['100002']);
		expect(find('花子')).toEqual(['100002']);
		expect(find('2000')).toEqual(['200003']);
		expect(find('')).toHaveLength(3);
	});

	it('学期で絞れる', () => {
		addSubject({ syllabusId: '1', name: '前期の科目', term: 'spring' });
		addSubject({ syllabusId: '2', name: '後期の科目', term: 'fall' });

		const result = searchSubjects(
			{ subjects: createSubjectStore(database) },
			{ academicYear: 2026, term: 'spring' },
		);

		expect(result.subjects.map((s) => s.name)).toEqual(['前期の科目']);
	});

	it('公開でない、利用者が足した科目は含めない', () => {
		const store = createSubjectStore(database);
		const owner = createAuthStore(database).createUser(
			{ googleSub: 'a', email: 'a@fun.ac.jp', name: null, role: 'user' },
			NOW,
		);
		const id = store.createUserSubject(
			{ academicYear: 2026, name: '足した科目', term: 'fall', teacher: null },
			owner,
			NOW,
		);
		store.setVisibility(id, 'private');

		expect(
			searchSubjects({ subjects: createSubjectStore(database) }, { academicYear: 2026 }).subjects,
		).toEqual([]);

		store.setVisibility(id, 'public');
		expect(
			searchSubjects({ subjects: createSubjectStore(database) }, { academicYear: 2026 }).subjects,
		).toHaveLength(1);
	});

	it('上限を超えたら、切って truncated を返す', () => {
		for (let i = 0; i < SUBJECT_SEARCH_LIMIT + 5; i++) {
			addSubject({ syllabusId: String(1000 + i), name: `科目 ${i}` });
		}

		const result = searchSubjects(
			{ subjects: createSubjectStore(database) },
			{ academicYear: 2026 },
		);

		expect(result.subjects).toHaveLength(SUBJECT_SEARCH_LIMIT);
		expect(result.truncated).toBe(true);
	});
});

describe('getSubjectSessions', () => {
	function setupSubject() {
		const subjectId = addSubject({ syllabusId: '100001', name: '架空の代数' });
		createCourseStore(database).addSharedSlots(
			[{ subjectId, weekday: 1, period: 3, room: '484' }],
			{ source: 'manual', createdBy: null },
			NOW,
		);
		createAcademicCalendarStore(database).saveTerm(
			2026,
			{ term: 'fall', start: '2026-10-05', end: '2026-10-25' },
			'manual',
			NOW,
		);
		return subjectId;
	}

	it('学期の授業日を、時刻つきで並べる。休講の回は通し番号がなく、補講は含まれる', () => {
		const subjectId = setupSubject();
		createHolidayStore(database).replaceAll('cabinetOffice', [
			{ date: '2026-10-12', name: 'スポーツの日' },
		]);

		const result = getSubjectSessions(
			sources(),
			{ academicYear: 2026, syllabusId: '100001' },
			viewerOf('v1'),
		);

		expect(result?.subject).toMatchObject({ syllabusId: '100001', name: '架空の代数' });
		// 10-05、10-19 (10-12 は祝日)
		expect(result?.sessions.map((s) => `${s.date} ${s.start}-${s.end} #${s.sequence}`)).toEqual([
			'2026-10-05 13:10-14:40 #1',
			'2026-10-19 13:10-14:40 #2',
		]);
		expect(result?.sessions[0]).toMatchObject({ room: '484', subjectId });
	});

	it('履修登録とは関係なく、呼んだ人の履修は見ない', () => {
		setupSubject();

		const result = getSubjectSessions(
			sources(),
			{ academicYear: 2026, syllabusId: '100001' },
			viewerOf('someone'),
		);

		expect(result?.sessions.length).toBeGreaterThan(0);
	});

	it('ない科目は null', () => {
		expect(
			getSubjectSessions(sources(), { academicYear: 2026, syllabusId: 'none' }, viewerOf('v1')),
		).toBeNull();
	});

	it('見られない非公開の科目は null (存在を漏らさない)', () => {
		const store = createSubjectStore(database);
		const owner = createAuthStore(database).createUser(
			{ googleSub: 'a', email: 'a@fun.ac.jp', name: null, role: 'user' },
			NOW,
		);
		const id = store.createUserSubject(
			{ academicYear: 2026, name: '内緒の科目', term: 'fall', teacher: null },
			owner,
			NOW,
		);
		store.setVisibility(id, 'private');
		const syllabusId = store.findById(id)?.syllabusId ?? '';

		expect(
			getSubjectSessions(sources(), { academicYear: 2026, syllabusId }, viewerOf('other')),
		).toBeNull();
		expect(
			getSubjectSessions(
				sources(),
				{ academicYear: 2026, syllabusId },
				{ id: owner, email: 'a@fun.ac.jp', role: 'user' },
			),
		).not.toBeNull();
	});
});
