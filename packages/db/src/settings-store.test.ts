import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from './database.ts';
import { createSettingsStore } from './settings-store.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-settings-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

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
