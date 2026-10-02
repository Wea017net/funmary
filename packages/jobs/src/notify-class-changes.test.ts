import { createLogger } from '@funmary/log';
import { describe, expect, it } from 'vitest';
import {
	classChangeNotification,
	createNotifyClassChangesJob,
	createPruneNotificationsJob,
} from './notify-class-changes.ts';

const log = createLogger({ level: 'error', format: 'text', mode: 'production' });
const context = (iso: string) => ({
	signal: new AbortController().signal,
	now: () => new Date(iso),
	log,
});

const candidate = {
	userId: 'u1',
	classChangeId: 12,
	kind: 'roomChange' as const,
	date: '2026-10-03',
	period: 2,
	room: '講義室 B',
	fromRoom: '講義室 A',
	subjectId: 5,
	subjectName: '情報処理演習',
	academicYear: 2026,
	syllabusId: '100201',
};

describe('休講などの通知の文', () => {
	it('種類、科目名、日付と時限を題に入れ、授業の詳細の画面へつなぐ', () => {
		expect(classChangeNotification(candidate)).toEqual({
			userId: 'u1',
			kind: 'roomChange',
			title: '[教室変更] 情報処理演習 (10/3 2 限)',
			body: '講義室 A → 講義室 B',
			link: '/app/subjects/2026/100201',
			subjectId: 5,
			dedupeKey: 'class-change:12',
		});
		expect(
			classChangeNotification({ ...candidate, kind: 'cancellation', room: null, fromRoom: null }),
		).toMatchObject({ title: '[休講] 情報処理演習 (10/3 2 限)', body: null });
		expect(classChangeNotification({ ...candidate, kind: 'makeup', fromRoom: null })).toMatchObject(
			{ title: '[補講] 情報処理演習 (10/3 2 限)', body: '教室: 講義室 B' },
		);
	});
});

describe('休講などを通知欄に入れる定期処理', () => {
	it('日本時間の今日以降の候補を、通知欄に足す。足した数を返し、なければ何も返さない', async () => {
		const days: string[] = [];
		let inserted = [1];
		const job = createNotifyClassChangesJob({
			candidates: (today) => {
				days.push(today);
				return [candidate];
			},
			insert: (entries) => (entries.length > 0 ? inserted : []),
		});
		// 日本時間では 10 月 3 日の 0 時半
		await expect(job.run(context('2026-10-02T15:30:00Z'))).resolves.toBe(
			'休講などの通知を 1 件足しました',
		);
		expect(days).toEqual(['2026-10-03']);
		inserted = [];
		await expect(job.run(context('2026-10-02T15:35:00Z'))).resolves.toBeUndefined();
		expect(job.quietWhenIdle).toBe(true);
	});
});

describe('古い通知を消す定期処理', () => {
	it('90 日より前の通知を消す', async () => {
		const befores: Date[] = [];
		const job = createPruneNotificationsJob({
			prune: (before) => {
				befores.push(before);
				return 3;
			},
		});
		await expect(job.run(context('2026-10-02T00:00:00Z'))).resolves.toBe(
			'90 日より前の通知を 3 件消しました',
		);
		expect(befores).toEqual([new Date('2026-07-04T00:00:00Z')]);
	});
});
