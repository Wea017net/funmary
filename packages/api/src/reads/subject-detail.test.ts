import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createAccessGrantStore,
	createAuthStore,
	createClassChangeStore,
	createSubjectStore,
	openDatabase,
	type Database,
} from '@funmary/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSubjectDetail } from './subject-detail.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-subject-detail-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date('2026-10-07T00:00:00Z');

function sources() {
	return {
		subjects: createSubjectStore(database),
		accessGrants: createAccessGrantStore(database),
		classChanges: createClassChangeStore(database),
	};
}

function newUser(sub: string) {
	const id = createAuthStore(database).createUser(
		{ googleSub: sub, email: `${sub}@fun.ac.jp`, name: null, role: 'user' },
		NOW,
	);
	return { id, email: `${sub}@fun.ac.jp`, role: 'user' as const };
}

const user = (id: string, email: string) => ({ id, email, role: 'user' as const });
const admin = { id: 'a1', email: 'a1@fun.ac.jp', role: 'admin' as const };

describe('getSubjectDetail', () => {
	it('シラバスの科目は、誰でも見られる', () => {
		const src = sources();
		src.subjects.upsert(
			{
				academicYear: 2026,
				syllabusId: '100201',
				name: '情報処理演習',
				teacher: null,
				credits: 2,
				term: 'spring',
				attributes: {},
				syllabus: {},
				syllabusUrl: null,
			},
			NOW,
		);
		const detail = getSubjectDetail(
			src,
			{ academicYear: 2026, syllabusId: '100201' },
			user('u1', 'u1@fun.ac.jp'),
		);
		expect(detail?.subject.name).toBe('情報処理演習');
		expect(detail?.changes).toEqual([]);
	});

	it('存在しない科目は null', () => {
		const src = sources();
		expect(
			getSubjectDetail(
				src,
				{ academicYear: 2026, syllabusId: 'unknown' },
				user('u1', 'u1@fun.ac.jp'),
			),
		).toBeNull();
	});

	it('private な自作科目は、足した人と管理者だけ見られる', () => {
		const src = sources();
		const owner = newUser('u1');
		const other = newUser('u2');
		const id = src.subjects.createUserSubject(
			{ academicYear: 2026, name: 'サークルの活動', term: 'spring', teacher: null },
			owner.id,
			NOW,
		);
		src.subjects.setVisibility(id, 'private');
		const subject = src.subjects.findById(id);
		if (!subject) throw new Error('見つかりません');

		expect(getSubjectDetail(src, subject, owner)).not.toBeNull();
		expect(getSubjectDetail(src, subject, admin)).not.toBeNull();
		expect(getSubjectDetail(src, subject, other)).toBeNull();
	});

	it('招待されたメールアドレスなら private でも見られる', () => {
		const src = sources();
		const owner = newUser('u1');
		const other = newUser('u2');
		const id = src.subjects.createUserSubject(
			{ academicYear: 2026, name: 'サークルの活動', term: 'spring', teacher: null },
			owner.id,
			NOW,
		);
		src.subjects.setVisibility(id, 'private');
		const subject = src.subjects.findById(id);
		if (!subject) throw new Error('見つかりません');

		expect(getSubjectDetail(src, subject, other)).toBeNull();
		src.accessGrants.grant('subject', id, other.email, NOW);
		expect(getSubjectDetail(src, subject, other)).not.toBeNull();
	});

	it('休講などの履歴を一緒に返す', () => {
		const src = sources();
		const id = src.subjects.upsert(
			{
				academicYear: 2026,
				syllabusId: '100201',
				name: '情報処理演習',
				teacher: null,
				credits: 2,
				term: 'spring',
				attributes: {},
				syllabus: {},
				syllabusUrl: null,
			},
			NOW,
		);
		src.classChanges.apply(
			[
				{
					kind: 'cancellation',
					lessonName: '情報処理演習',
					date: '2026-10-10',
					period: 2,
					teacher: null,
					campus: null,
					room: null,
					fromRoom: null,
					comment: null,
					makeupPlan: null,
					missingCount: 0,
					withdrawn: false,
				},
			],
			NOW,
		);
		src.classChanges.assignSubject('情報処理演習', id);
		const detail = getSubjectDetail(src, { academicYear: 2026, syllabusId: '100201' }, admin);
		expect(detail?.changes).toHaveLength(1);
		expect(detail?.changes[0]?.kind).toBe('cancellation');
	});
});
