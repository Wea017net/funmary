import { createAuthStore, createNotificationStore, type Database } from '@funmary/db';
import { describe, expect, it } from 'vitest';
import { listUserNotifications } from './notifications.ts';
import { useTestDatabase } from '@funmary/db/testing';

let database: Database;
useTestDatabase('funmary-notifications-', (db) => (database = db));

const NOW = new Date('2026-10-07T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function newUser(sub: string) {
	return createAuthStore(database).createUser(
		{ googleSub: sub, email: `${sub}@fun.ac.jp`, name: null, role: 'user' },
		NOW,
	);
}

const entry = (overrides: {
	userId: string;
	kind: 'cancellation' | 'makeup' | 'roomChange' | 'integration' | 'notice';
	title: string;
}) => ({ ...overrides, body: null, link: null, subjectId: null, dedupeKey: null });

describe('listUserNotifications', () => {
	it('新しい順に、その人の通知だけを返す', () => {
		const notifications = createNotificationStore(database);
		const a = newUser('a');
		const b = newUser('b');
		notifications.insertMany(
			[
				entry({ userId: a, kind: 'cancellation', title: '1 件目' }),
				entry({ userId: b, kind: 'cancellation', title: 'B の通知' }),
			],
			NOW,
		);
		notifications.insertMany(
			[entry({ userId: a, kind: 'makeup', title: '2 件目' })],
			new Date(NOW.getTime() + 1000),
		);
		const result = listUserNotifications({ notifications }, a);
		expect(result.map((row) => row.title)).toEqual(['2 件目', '1 件目']);
	});

	it('kinds で複数の種類に絞れる', () => {
		const notifications = createNotificationStore(database);
		const a = newUser('a');
		notifications.insertMany(
			[
				entry({ userId: a, kind: 'cancellation', title: '休講' }),
				entry({ userId: a, kind: 'makeup', title: '補講' }),
				entry({ userId: a, kind: 'roomChange', title: '教室変更' }),
			],
			NOW,
		);
		const result = listUserNotifications({ notifications }, a, {
			kinds: ['cancellation', 'makeup'],
		});
		expect(result.map((row) => row.kind).sort()).toEqual(['cancellation', 'makeup']);
	});

	it('since より新しいものだけを返す', () => {
		const notifications = createNotificationStore(database);
		const a = newUser('a');
		notifications.insertMany(
			[entry({ userId: a, kind: 'cancellation', title: '古い' })],
			new Date(NOW.getTime() - 2 * DAY),
		);
		notifications.insertMany([entry({ userId: a, kind: 'cancellation', title: '新しい' })], NOW);
		const result = listUserNotifications({ notifications }, a, {
			since: new Date(NOW.getTime() - DAY),
		});
		expect(result.map((row) => row.title)).toEqual(['新しい']);
	});

	it('limit で絞り込み後の件数を切れる', () => {
		const notifications = createNotificationStore(database);
		const a = newUser('a');
		notifications.insertMany(
			[1, 2, 3].map((n) => entry({ userId: a, kind: 'cancellation', title: `${n} 件目` })),
			NOW,
		);
		expect(listUserNotifications({ notifications }, a, { limit: 2 })).toHaveLength(2);
	});
});
