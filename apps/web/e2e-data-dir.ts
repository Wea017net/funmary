import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * E2E テストのサーバーが DB を置く場所。テスト本体は、ここの DB に科目を入れてから画面を確かめる。
 * Playwright はテストの前に test-results を消すので、別の場所に置く
 */
export const E2E_DATA_DIR = join(tmpdir(), 'funmary-e2e-data');
