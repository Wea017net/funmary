import {
	createApiActivityStore,
	createAuthStore,
	createNotificationStore,
	type Database,
} from '@funmary/db';
import { useTestDatabase } from '@funmary/db/testing';
import { describe, expect, it } from 'vitest';
import type { WriteActor } from './events.ts';
import { markAllNotificationsRead, markNotificationRead } from './notifications.ts';

let database: Database;
useTestDatabase('funmary-write-notifications-', (db) => (database = db));

const NOW = new Date('2026-10-07T00:00:00Z');

function setup() {
	const auth = createAuthStore(database);
	const user = (sub: string) =>
		auth.createUser({ googleSub: sub, email: `${sub}@fun.ac.jp`, name: null, role: 'user' }, NOW);
	const sources = {
		notifications: createNotificationStore(database),
		activity: createApiActivityStore(database),
	};
	const actorOf = (userId: string): WriteActor => ({ userId, tokenId: 3, tokenName: 'スクリプト' });
	const notify = (userId: string, title: string) => {
		const [id] = sources.notifications.insertMany(
			[
				{
					userId,
					kind: 'notice',
					title,
					body: null,
					link: null,
					subjectId: null,
					dedupeKey: `test:${userId}:${title}`,
				},
			],
			NOW,
		);
		if (id === undefined) throw new Error('通知を足せるはず');
		return id;
	};
	return { sources, user, actorOf, notify };
}

describe('通知を、トークンから既読にする', () => {
	it('自分の通知を既読にして、履歴に残す', () => {
		const { sources, user, actorOf, notify } = setup();
		const a = user('a');
		const id = notify(a, '休講のお知らせ');

		const result = markNotificationRead(sources, actorOf(a), id, NOW);

		expect(result).toMatchObject({ ok: true, notification: { id, readAt: NOW } });
		expect(sources.notifications.unreadCount(a)).toBe(0);
		expect(sources.activity.listRecent(a)[0]).toMatchObject({
			action: 'notification.read',
			targetId: id,
			summary: '通知「休講のお知らせ」を既読にした',
		});
	});

	it('ほかの人の通知や、ない通知は、見つからないことにして、何も変えない', () => {
		const { sources, user, actorOf, notify } = setup();
		const a = user('a');
		const b = user('b');
		const id = notify(a, 'a の通知');

		expect(markNotificationRead(sources, actorOf(b), id, NOW)).toEqual({
			ok: false,
			kind: 'not_found',
			error: '通知が見つかりません',
		});
		expect(sources.notifications.unreadCount(a)).toBe(1);
		expect(sources.activity.listRecent(b)).toEqual([]);
	});

	it('すべて既読にすると、件数を返し、履歴に 1 件だけ残す。未読がなければ何も残さない', () => {
		const { sources, user, actorOf, notify } = setup();
		const a = user('a');
		notify(a, '1 つ目');
		notify(a, '2 つ目');

		expect(markAllNotificationsRead(sources, actorOf(a), NOW)).toEqual({ ok: true, count: 2 });
		expect(markAllNotificationsRead(sources, actorOf(a), NOW)).toEqual({ ok: true, count: 0 });

		expect(sources.activity.listRecent(a)).toMatchObject([
			{ action: 'notification.readAll', summary: '通知 2 件を、すべて既読にした' },
		]);
	});
});
