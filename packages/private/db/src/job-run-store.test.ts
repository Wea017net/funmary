import { describe, expect, it } from 'vitest';
import type { Database } from './database.ts';
import { createJobRunStore } from './job-run-store.ts';
import { useTestDatabase } from './testing.ts';

let database: Database;
useTestDatabase('funmary-jobs-', (db) => (database = db));

const at = (iso: string) => new Date(iso);

describe('createJobRunStore', () => {
	it('動き始めを記録し、終わったら結果と時刻を書き足す', () => {
		const store = createJobRunStore(database);
		const id = store.start('scrape-portal', at('2026-10-01T07:00:00Z'));
		expect(store.recent('scrape-portal', 5)).toMatchObject([
			{ id, job: 'scrape-portal', status: 'running', finishedAt: null, message: null },
		]);
		store.finish(id, 'succeeded', '12 件', at('2026-10-01T07:00:05Z'));
		expect(store.recent('scrape-portal', 5)).toEqual([
			{
				id,
				job: 'scrape-portal',
				startedAt: at('2026-10-01T07:00:00Z'),
				finishedAt: at('2026-10-01T07:00:05Z'),
				status: 'succeeded',
				message: '12 件',
			},
		]);
	});

	it('動かさなかったことも記録する', () => {
		const store = createJobRunStore(database);
		store.recordSkipped('scrape-portal', at('2026-10-01T07:00:00Z'), '前の実行が終わっていない');
		expect(store.recent('scrape-portal', 5)[0]).toMatchObject({
			status: 'skipped',
			message: '前の実行が終わっていない',
			finishedAt: at('2026-10-01T07:00:00Z'),
		});
	});

	it('新しい順に、指定した数だけ返し、タスクごとに分ける', () => {
		const store = createJobRunStore(database);
		for (let i = 1; i <= 4; i++) store.recordSkipped('a', at(`2026-10-0${i}T00:00:00Z`), `${i}`);
		store.recordSkipped('b', at('2026-10-05T00:00:00Z'), 'b');
		expect(store.recent('a', 2).map((r) => r.message)).toEqual(['4', '3']);
		expect(store.recent('b', 5)).toHaveLength(1);
	});

	it('すべてのタスクの記録を、新しい順に、指定した数だけ返す', () => {
		const store = createJobRunStore(database);
		store.recordSkipped('a', at('2026-10-01T00:00:00Z'), 'a1');
		store.recordSkipped('b', at('2026-10-03T00:00:00Z'), 'b1');
		store.recordSkipped('a', at('2026-10-02T00:00:00Z'), 'a2');
		expect(store.recentAll(2).map((r) => r.message)).toEqual(['b1', 'a2']);
		expect(store.recentAll(10)).toHaveLength(3);
	});

	it('残っている "running" は、プロセスが落ちた名残なので、起動時に失敗として閉じられる', () => {
		const store = createJobRunStore(database);
		const id = store.start('scrape-portal', at('2026-10-01T07:00:00Z'));
		expect(store.closeInterrupted(at('2026-10-01T08:00:00Z'))).toBe(1);
		expect(store.recent('scrape-portal', 1)[0]).toMatchObject({
			id,
			status: 'failed',
			finishedAt: at('2026-10-01T08:00:00Z'),
		});
		expect(store.recent('scrape-portal', 1)[0]?.message).toContain('途中');
		expect(store.closeInterrupted(at('2026-10-01T09:00:00Z'))).toBe(0);
	});

	it('古い記録を消す。動いている最中のものは消さない', () => {
		const store = createJobRunStore(database);
		store.recordSkipped('a', at('2026-01-01T00:00:00Z'), 'old');
		store.recordSkipped('a', at('2026-09-30T00:00:00Z'), 'new');
		store.start('a', at('2026-01-02T00:00:00Z'));
		expect(store.prune(at('2026-08-01T00:00:00Z'))).toBe(1);
		expect(store.recent('a', 10).map((r) => r.message)).toEqual(['new', null]);
	});
});
