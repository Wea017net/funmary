import { describe, expect, it } from 'vitest';
import { createApiActivityStore, API_ACTIVITY_LIMIT } from './api-activity-store.ts';
import { createAuthStore } from './auth-store.ts';
import type { Database } from './database.ts';
import { useTestDatabase } from './testing.ts';

let database: Database;
useTestDatabase('funmary-api-activity-', (db) => (database = db));

const t0 = new Date('2026-10-01T00:00:00Z');
const later = (ms: number) => new Date(t0.getTime() + ms);

function addUser(email: string) {
	return createAuthStore(database).createUser(
		{ googleSub: email, email, name: null, role: 'user' },
		t0,
	);
}

const entry = (userId: string, summary: string) => ({
	userId,
	tokenId: 7,
	tokenName: '手元の Claude Desktop',
	action: 'event.create' as const,
	targetId: 12,
	summary,
});

describe('書き込みの履歴', () => {
	it('記録した順に、新しいものから返す。どのトークンが何をしたかが分かる', () => {
		const userId = addUser('a@fun.ac.jp');
		const store = createApiActivityStore(database);
		store.record(entry(userId, '予定「歯医者」を足した'), t0);
		store.record(entry(userId, '予定「面談」を足した'), later(1000));

		expect(store.listRecent(userId)).toMatchObject([
			{
				summary: '予定「面談」を足した',
				tokenName: '手元の Claude Desktop',
				action: 'event.create',
			},
			{ summary: '予定「歯医者」を足した', targetId: 12 },
		]);
	});

	it('ほかの利用者の履歴は返さない', () => {
		const a = addUser('a@fun.ac.jp');
		const b = addUser('b@fun.ac.jp');
		const store = createApiActivityStore(database);
		store.record(entry(a, 'a の記録'), t0);
		store.record(entry(b, 'b の記録'), t0);

		expect(store.listRecent(a).map((row) => row.summary)).toEqual(['a の記録']);
	});

	it(`1 人につき、最新の ${API_ACTIVITY_LIMIT} 件だけを残し、古いものから消す。ほかの人の分は減らさない`, () => {
		const a = addUser('a@fun.ac.jp');
		const b = addUser('b@fun.ac.jp');
		const store = createApiActivityStore(database);
		store.record(entry(b, 'b の記録'), t0);
		for (let i = 0; i < API_ACTIVITY_LIMIT + 5; i++) {
			store.record(entry(a, `記録 ${i}`), later(i * 1000));
		}

		const rows = store.listRecent(a, API_ACTIVITY_LIMIT + 50);
		expect(rows).toHaveLength(API_ACTIVITY_LIMIT);
		expect(rows[0]?.summary).toBe(`記録 ${API_ACTIVITY_LIMIT + 4}`);
		expect(rows.at(-1)?.summary).toBe('記録 5');
		expect(store.listRecent(b)).toHaveLength(1);
	});

	it('取り消したトークンの名前も、履歴には残る', () => {
		const userId = addUser('a@fun.ac.jp');
		const store = createApiActivityStore(database);
		store.record({ ...entry(userId, '予定を足した'), tokenId: null }, t0);

		expect(store.listRecent(userId)[0]).toMatchObject({
			tokenId: null,
			tokenName: '手元の Claude Desktop',
		});
	});
});
