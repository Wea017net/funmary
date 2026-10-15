import { describe, expect, it } from 'vitest';
import { createAccessGrantStore } from './access-grant-store.ts';
import type { Database } from './database.ts';
import { useTestDatabase } from './testing.ts';

let database: Database;
useTestDatabase('funmary-access-grants-', (db) => (database = db));

const at = (iso: string) => new Date(iso);

describe('createAccessGrantStore', () => {
	it('招待したメールアドレスは isGranted で true になる。大文字と空白の違いは無視する', () => {
		const store = createAccessGrantStore(database);
		store.grant('subject', 1, ' Friend@Fun.AC.JP ', at('2026-01-01'));
		expect(store.isGranted('subject', 1, 'friend@fun.ac.jp')).toBe(true);
		expect(store.isGranted('subject', 1, 'other@fun.ac.jp')).toBe(false);
		// 対象や種類が違えば、別の招待として扱う
		expect(store.isGranted('event', 1, 'friend@fun.ac.jp')).toBe(false);
		expect(store.isGranted('subject', 2, 'friend@fun.ac.jp')).toBe(false);
	});

	it('同じ組を 2 回招待しても、1 件のまま', () => {
		const store = createAccessGrantStore(database);
		store.grant('subject', 1, 'friend@fun.ac.jp', at('2026-01-01'));
		store.grant('subject', 1, 'friend@fun.ac.jp', at('2026-01-02'));
		expect(store.list('subject', 1)).toHaveLength(1);
	});

	it('一覧と、外すこと', () => {
		const store = createAccessGrantStore(database);
		store.grant('event', 5, 'a@fun.ac.jp', at('2026-01-01'));
		store.grant('event', 5, 'b@fun.ac.jp', at('2026-01-02'));
		expect(store.list('event', 5).map((g) => g.granteeEmail)).toEqual([
			'a@fun.ac.jp',
			'b@fun.ac.jp',
		]);

		expect(store.revoke('event', 5, 'a@fun.ac.jp')).toBe(true);
		expect(store.revoke('event', 5, 'a@fun.ac.jp')).toBe(false);
		expect(store.list('event', 5).map((g) => g.granteeEmail)).toEqual(['b@fun.ac.jp']);
	});

	it('revokeAll で、対象の招待をまとめて消す', () => {
		const store = createAccessGrantStore(database);
		store.grant('subject', 1, 'a@fun.ac.jp', at('2026-01-01'));
		store.grant('subject', 1, 'b@fun.ac.jp', at('2026-01-01'));
		store.grant('subject', 2, 'a@fun.ac.jp', at('2026-01-01'));
		store.revokeAll('subject', 1);
		expect(store.list('subject', 1)).toEqual([]);
		expect(store.list('subject', 2)).toHaveLength(1);
	});
});
