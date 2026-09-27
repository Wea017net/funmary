import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthStore } from './auth-store.ts';
import { createCourseStore, type PortalCell } from './course-store.ts';
import { openDatabase, type Database } from './database.ts';
import { createSubjectStore } from './subject-store.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-courses-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const T0 = new Date('2026-09-27T00:00:00Z');

function setup() {
	const auth = createAuthStore(database);
	const alice = auth.createUser(
		{ googleSub: 'a', email: 'a@fun.ac.jp', name: null, role: 'user' },
		T0,
	);
	const bob = auth.createUser(
		{ googleSub: 'b', email: 'b@fun.ac.jp', name: null, role: 'user' },
		T0,
	);
	const subjects = createSubjectStore(database);
	const subjectId = subjects.upsert(
		{
			academicYear: 2026,
			syllabusId: '100002',
			name: '架空の科目B',
			teacher: null,
			credits: 2,
			term: 'fall',
			attributes: {},
			syllabus: {},
			syllabusUrl: null,
		},
		T0,
	);
	return { auth, alice, bob, subjectId, courses: createCourseStore(database) };
}

const cell = (over: Partial<PortalCell> = {}): PortalCell => ({
	lessonId: '100002',
	year: 2026,
	weekday: 1,
	period: 1,
	room: '494C&D',
	hopeUrl: 'https://hope.fun.ac.jp/2026/course/view.php?idnumber=1',
	...over,
});

describe('CourseStore.importFromPortal', () => {
	it('履修登録と、科目ごとの枠 (曜日、時限、教室) を登録する', () => {
		const { alice, subjectId, courses } = setup();
		const result = courses.importFromPortal(alice, [cell()], T0);
		expect(result).toMatchObject({ registered: 1, slotsAdded: 1, unknown: [], conflicts: [] });
		expect(courses.listRegistrations(alice)).toEqual([
			expect.objectContaining({
				subjectId,
				hopeCourseUrl: 'https://hope.fun.ac.jp/2026/course/view.php?idnumber=1',
			}),
		]);
		expect(courses.slotsOf(subjectId)).toEqual([
			expect.objectContaining({
				weekday: 1,
				period: 1,
				room: '494C&D',
				source: 'portal',
				createdBy: alice,
			}),
		]);
	});

	it('ほかの人が登録した枠は、同じ科目を取る全員で共有する (同じ内容なら、登録し直さない)', () => {
		const { alice, bob, subjectId, courses } = setup();
		courses.importFromPortal(alice, [cell()], T0);
		const result = courses.importFromPortal(bob, [cell()], T0);
		expect(result).toMatchObject({ registered: 1, slotsAdded: 0, conflicts: [] });
		expect(courses.slotsOf(subjectId)).toHaveLength(1);
		expect(courses.slotsOf(subjectId)[0]!.createdBy).toBe(alice);
	});

	it('既にある枠と教室が違えば、上書きせず、食い違いとして返す', () => {
		const { alice, bob, subjectId, courses } = setup();
		courses.importFromPortal(alice, [cell()], T0);
		const result = courses.importFromPortal(bob, [cell({ room: '595' })], T0);
		expect(result.conflicts).toEqual([
			{ subjectId, weekday: 1, period: 1, existingRoom: '494C&D', importedRoom: '595' },
		]);
		expect(courses.slotsOf(subjectId)[0]!.room).toBe('494C&D');
	});

	it('既にある枠の教室が空なら、取り込んだ教室で埋める', () => {
		const { alice, bob, subjectId, courses } = setup();
		courses.importFromPortal(alice, [cell({ room: null })], T0);
		const result = courses.importFromPortal(bob, [cell()], T0);
		expect(result).toMatchObject({ slotsUpdated: 1, conflicts: [] });
		expect(courses.slotsOf(subjectId)[0]!.room).toBe('494C&D');
	});

	it('まだ取り込んでいない科目は、登録せず、知らない科目として返す', () => {
		const { alice, courses } = setup();
		const result = courses.importFromPortal(alice, [cell({ lessonId: '999999' })], T0);
		expect(result).toMatchObject({ registered: 0, unknown: [{ lessonId: '999999', year: 2026 }] });
		expect(courses.listRegistrations(alice)).toEqual([]);
	});

	it('曜日と時限のないコマ (集中講義) は、履修登録だけ行う', () => {
		const { alice, subjectId, courses } = setup();
		const result = courses.importFromPortal(alice, [cell({ weekday: null, period: null })], T0);
		expect(result).toMatchObject({ registered: 1, slotsAdded: 0 });
		expect(courses.slotsOf(subjectId)).toEqual([]);
	});

	it('同じ取り込みを 2 回しても、履修登録は 1 つのまま', () => {
		const { alice, courses } = setup();
		courses.importFromPortal(alice, [cell()], T0);
		const again = courses.importFromPortal(alice, [cell()], T0);
		expect(again.registered).toBe(0);
		expect(courses.listRegistrations(alice)).toHaveLength(1);
	});

	it('退会した利用者が登録した枠は、残り、登録者だけ空になる', () => {
		const { alice, subjectId, courses } = setup();
		courses.importFromPortal(alice, [cell()], T0);
		database.sqlite.prepare('DELETE FROM users WHERE id = ?').run(alice);
		expect(courses.slotsOf(subjectId)).toEqual([
			expect.objectContaining({ room: '494C&D', createdBy: null }),
		]);
	});
});
