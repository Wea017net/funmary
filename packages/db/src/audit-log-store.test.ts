import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuditLogStore } from './audit-log-store.ts';
import { createAuthStore } from './auth-store.ts';
import { openDatabase, type Database } from './database.ts';
import { createSubjectStore } from './subject-store.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-audit-log-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const at = (iso: string) => new Date(iso);

const addUser = (email: string) =>
	createAuthStore(database).createUser(
		{ googleSub: email, email, name: null, role: 'user' },
		at('2026-01-01T00:00:00Z'),
	);

describe('createAuditLogStore', () => {
	it('記録した順ではなく、新しい順に返す', () => {
		const store = createAuditLogStore(database);
		const userId = addUser('taro@fun.ac.jp');
		const subjectStore = createSubjectStore(database);
		const subjectId = subjectStore.createUserSubject(
			{ academicYear: 2026, name: 'キャリアガイダンス', term: 'fall', teacher: null },
			userId,
			at('2026-01-01T00:00:00Z'),
		);
		const syllabusId = subjectStore.findById(subjectId)?.syllabusId;
		store.record(
			{
				actorId: userId,
				action: 'subject.create',
				subjectId,
				summary: 'キャリアガイダンスを足した',
			},
			at('2026-10-01T00:00:00Z'),
		);
		store.record(
			{ actorId: userId, action: 'subject.delete', subjectId, summary: '同じ科目を消した' },
			at('2026-10-02T00:00:00Z'),
		);
		expect(store.recent(10)).toMatchObject([
			{
				actorEmail: 'taro@fun.ac.jp',
				action: 'subject.delete',
				subjectId,
				subject: { academicYear: 2026, syllabusId },
				summary: '同じ科目を消した',
				createdAt: at('2026-10-02T00:00:00Z'),
			},
			{
				actorEmail: 'taro@fun.ac.jp',
				action: 'subject.create',
				subjectId,
				subject: { academicYear: 2026, syllabusId },
				summary: 'キャリアガイダンスを足した',
				createdAt: at('2026-10-01T00:00:00Z'),
			},
		]);
	});

	it('count 件までしか返さない', () => {
		const store = createAuditLogStore(database);
		const userId = addUser('taro@fun.ac.jp');
		for (let i = 0; i < 5; i++) {
			store.record(
				{ actorId: userId, action: 'subject.create', summary: `${i} 件目` },
				at('2026-10-01T00:00:00Z'),
			);
		}
		expect(store.recent(3)).toHaveLength(3);
	});

	it('関わった科目が消えても、記録は残り subject だけ null になる', () => {
		const store = createAuditLogStore(database);
		const userId = addUser('taro@fun.ac.jp');
		const subjectStore = createSubjectStore(database);
		const subjectId = subjectStore.createUserSubject(
			{ academicYear: 2026, name: 'キャリアガイダンス', term: 'fall', teacher: null },
			userId,
			at('2026-01-01T00:00:00Z'),
		);
		store.record(
			{
				actorId: userId,
				action: 'subject.delete',
				subjectId,
				summary: 'キャリアガイダンスを消した',
			},
			at('2026-10-01T00:00:00Z'),
		);
		subjectStore.deleteUserSubject(subjectId);
		expect(store.recent(10)).toMatchObject([
			{ subjectId: null, subject: null, summary: 'キャリアガイダンスを消した' },
		]);
	});

	it('行った人が退会 (users から削除) しても、記録は残り actorEmail だけ null になる', () => {
		const store = createAuditLogStore(database);
		const userId = addUser('jiro@fun.ac.jp');
		store.record(
			{ actorId: userId, action: 'lesson.resolve', summary: '授業名を紐付けた' },
			at('2026-10-01T00:00:00Z'),
		);
		database.sqlite.prepare('DELETE FROM users WHERE id = ?').run(userId);
		expect(store.recent(10)).toMatchObject([{ actorEmail: null, summary: '授業名を紐付けた' }]);
	});
});
