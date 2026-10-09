import {
	createAuthStore,
	createFeedTokenStore,
	createNotificationStore,
	type Database,
} from '@funmary/db';
import { describe, expect, it } from 'vitest';
import { loadNotificationFeed, notificationFeedLinks } from './notification-feed.ts';
import { useTestDatabase } from '@funmary/db/testing';

/** 同意済みの利用者の購読として読む。同意待ちの印が返ったら、テストの組み立てが違う */
function loadAccepted(src: ReturnType<typeof sources>, token: string, now: Date) {
	const loaded = loadNotificationFeed(src, token, now);
	if (loaded === 'terms-required') throw new Error('同意済みの利用者のはず');
	return loaded;
}

let database: Database;
useTestDatabase('funmary-notification-feed-', (db) => (database = db));

const NOW = new Date('2026-10-07T00:00:00Z');

const TERMS_VERSION = '2026-10-03';

function sources() {
	return {
		auth: createAuthStore(database),
		termsVersion: TERMS_VERSION,
		feedTokens: createFeedTokenStore(database),
		notifications: createNotificationStore(database),
		origin: 'https://funmary.example.com',
	};
}

function newUser(sub: string, accepted = true) {
	const auth = createAuthStore(database);
	const id = auth.createUser(
		{ googleSub: sub, email: `${sub}@fun.ac.jp`, name: null, role: 'user' },
		NOW,
	);
	if (accepted) auth.acceptTerms(id, TERMS_VERSION, NOW);
	return id;
}

describe('通知のフィード', () => {
	it('知らないトークン、取り消したトークンでは null を返す', () => {
		const src = sources();
		const userId = newUser('a');
		const token = src.feedTokens.issue(userId, 'feed', NOW);
		expect(loadAccepted(src, 'unknown', NOW)).toBeNull();
		src.feedTokens.revoke(userId, 'feed', NOW);
		expect(loadAccepted(src, token, NOW)).toBeNull();
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
		const feed = loadAccepted(src, token, NOW);
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
		const feed = loadAccepted(src, token, NOW);
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
		const feed = loadAccepted(src, token, NOW);
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

describe('利用規約への同意', () => {
	it('持ち主が同意するまで、購読は通知を返さない', () => {
		const src = sources();
		const userId = newUser('a', false);
		const token = src.feedTokens.issue(userId, 'feed', NOW);

		expect(loadNotificationFeed(src, token, NOW)).toBe('terms-required');
	});

	it('同意すれば返す。規約が新しい版になれば、また止まる', () => {
		const src = sources();
		const userId = newUser('a', false);
		const token = src.feedTokens.issue(userId, 'feed', NOW);
		src.auth.acceptTerms(userId, TERMS_VERSION, NOW);

		expect(loadNotificationFeed(src, token, NOW)).not.toBe('terms-required');
		expect(loadNotificationFeed({ ...src, termsVersion: '2026-11-01' }, token, NOW)).toBe(
			'terms-required',
		);
	});
});
