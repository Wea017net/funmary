import { describe, expect, it } from 'vitest';
import type { Database } from './database.ts';
import { createSettingsStore } from './settings-store.ts';
import { useTestDatabase } from './testing.ts';

let database: Database;
useTestDatabase('funmary-settings-', (db) => (database = db));

describe('管理画面で変える設定', () => {
	it('なければ null を返し、保存した値 (JSON) を読み戻せる。保存し直すと上書きする', () => {
		const store = createSettingsStore(database);
		expect(store.get('invites')).toBeNull();
		store.set('invites', { issuers: 'anyone', monthlyLimit: 3 }, new Date('2026-10-01T00:00:00Z'));
		store.set(
			'invites',
			{ issuers: 'permitted', monthlyLimit: 2 },
			new Date('2026-10-02T00:00:00Z'),
		);
		expect(store.get('invites')).toEqual({ issuers: 'permitted', monthlyLimit: 2 });
	});
});
