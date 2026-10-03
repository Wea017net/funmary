import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createAuthStore,
	createFeedTokenStore,
	createNotificationStore,
	openDatabase,
	type Database,
} from '@funmary/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadNotificationFeed, notificationFeedLinks } from './notification-feed.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-notification-feed-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date('2026-10-07T00:00:00Z');

function sources() {
	return {
		feedTokens: createFeedTokenStore(database),
		notifications: createNotificationStore(database),
		origin: 'https://funmary.example.com',
	};
}

function newUser(sub: string) {
	return createAuthStore(database).createUser(
		{ googleSub: sub, email: `${sub}@fun.ac.jp`, name: null, role: 'user' },
		NOW,
	);
}

describe('通知のフィード', () => {
	it('知らないトークン、取り消したトークンでは null を返す', () => {
		const src = sources();
		const userId = newUser('a');
		const token = src.feedTokens.issue(userId, 'feed', NOW);
		expect(loadNotificationFeed(src, 'unknown', NOW)).toBeNull();
		src.feedTokens.revoke(userId, 'feed', NOW);
		expect(loadNotificationFeed(src, token, NOW)).toBeNull();
	});

	it('既定の種類 (休講、補講、教室変更、連携の不具合) だけを、新しい順に載せる', () => {
		const src = sources();
		const userId = newUser('a');
		const token = src.feedTokens.issue(userId, 'feed', NOW);
		src.notifications.insertMany(
			[
				{
					userId,
					kind: 'cancellation',
					title: '[休講] 情報処理演習 (10/3 2 限)',
					body: null,
					link: '/app/subjects/2026/100201',
					subjectId: null,
					dedupeKey: 'k1',
				},
				{
					userId,
					kind: 'notice',
					title: 'お知らせ',
					body: '本文',
					link: null,
					subjectId: null,
					dedupeKey: 'k2',
				},
			],
			NOW,
		);
		const feed = loadNotificationFeed(src, token, NOW);
		expect(feed?.items).toHaveLength(1);
		expect(feed?.items[0]).toMatchObject({
			title: '[休講] 情報処理演習 (10/3 2 限)',
			id: 'https://funmary.example.com/app/notifications#ntf-1',
			link: 'https://funmary.example.com/app/subjects/2026/100201',
			description: '[休講] 情報処理演習 (10/3 2 限)',
		});
		expect(feed?.options).toMatchObject({
			title: 'Funmary の通知',
			link: 'https://funmary.example.com/app/notifications',
		});
	});

	it('30 日より古い通知、最大件数を超えた分は載せない', () => {
		const src = sources();
		const userId = newUser('a');
		const token = src.feedTokens.issue(userId, 'feed', NOW);
		const old = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000);
		src.notifications.insertMany(
			[
				{
					userId,
					kind: 'cancellation',
					title: '古い休講',
					body: null,
					link: null,
					subjectId: null,
					dedupeKey: 'old',
				},
			],
			old,
		);
		for (let i = 0; i < 55; i++) {
			src.notifications.insertMany(
				[
					{
						userId,
						kind: 'cancellation',
						title: `休講 ${i}`,
						body: null,
						link: null,
						subjectId: null,
						dedupeKey: `new-${i}`,
					},
				],
				NOW,
			);
		}
		const feed = loadNotificationFeed(src, token, NOW);
		expect(feed?.items).toHaveLength(50);
		expect(feed?.items.map((item) => item.title)).not.toContain('古い休講');
	});

	it('設定した種類だけに絞れる', () => {
		const src = sources();
		const userId = newUser('a');
		const token = src.feedTokens.issue(userId, 'feed', NOW);
		src.feedTokens.setOptions(userId, 'feed', { kinds: ['makeup'] });
		src.notifications.insertMany(
			[
				{
					userId,
					kind: 'cancellation',
					title: '[休講] k1',
					body: null,
					link: null,
					subjectId: null,
					dedupeKey: 'k1',
				},
				{
					userId,
					kind: 'makeup',
					title: '[補講] k2',
					body: null,
					link: null,
					subjectId: null,
					dedupeKey: 'k2',
				},
			],
			NOW,
		);
		const feed = loadNotificationFeed(src, token, NOW);
		expect(feed?.items.map((item) => item.title)).toEqual(['[補講] k2']);
	});
});

describe('notificationFeedLinks', () => {
	it('トークンから、RSS、Atom、JSON Feed の URL を作る', () => {
		expect(notificationFeedLinks('https://funmary.example.com', 'tok')).toEqual({
			rss: 'https://funmary.example.com/feed/tok/rss.xml',
			atom: 'https://funmary.example.com/feed/tok/atom.xml',
			json: 'https://funmary.example.com/feed/tok/feed.json',
		});
	});
});
