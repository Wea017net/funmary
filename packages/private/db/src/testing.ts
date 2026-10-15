// テストが使う、一時的な DB。各テストの前に空の DB を作り、あとで閉じて、フォルダごと消す。
// どのテストも同じ数行を書いていたので、ここに 1 つだけ置く。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { openDatabase, type Database } from './database.ts';

/**
 * describe の外 (ファイルの先頭) で呼ぶ。テストごとに新しい DB を開き、use に渡す。
 * 使う側は、渡された DB を、ファイルの中の変数に覚えておく:
 *
 *     let database: Database;
 *     useTestDatabase('funmary-example-', (db) => (database = db));
 *
 * @param prefix 一時フォルダの名前の先頭。失敗したときに、どのテストのものか分かるようにする
 */
export function useTestDatabase(prefix: string, use: (database: Database, dir: string) => void) {
	let dir: string | undefined;
	let database: Database | undefined;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), prefix));
		database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
		use(database, dir);
	});

	afterEach(() => {
		database?.close();
		if (dir) rmSync(dir, { recursive: true, force: true });
	});
}
