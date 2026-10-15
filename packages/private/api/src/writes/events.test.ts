import {
	createAccessGrantStore,
	createApiActivityStore,
	createAuthStore,
	createUserEventStore,
	type Database,
} from '@funmary/db';
import { useTestDatabase } from '@funmary/db/testing';
import { describe, expect, it } from 'vitest';
import { createEvent, deleteEvent, getEvent, replaceEvent, type WriteActor } from './events.ts';

let database: Database;
useTestDatabase('funmary-write-events-', (db) => (database = db));

const NOW = new Date('2026-10-07T00:00:00Z');

function setup() {
	const auth = createAuthStore(database);
	const user = (sub: string) =>
		auth.createUser({ googleSub: sub, email: `${sub}@fun.ac.jp`, name: null, role: 'user' }, NOW);
	const sources = {
		userEvents: createUserEventStore(database),
		accessGrants: createAccessGrantStore(database),
		activity: createApiActivityStore(database),
	};
	const actorOf = (userId: string): WriteActor => ({
		userId,
		tokenId: 3,
		tokenName: '手元の Claude Desktop',
	});
	return { sources, user, actorOf };
}

const BODY = {
	title: '歯医者',
	startDate: '2026-10-20',
	time: { kind: 'time' as const, start: '10:00', end: '11:00' },
};

describe('予定を、トークンから足す、直す、消す', () => {
	it('足した予定は非公開で、履歴に、どのトークンが何をしたかが残る', () => {
		const { sources, user, actorOf } = setup();
		const a = user('a');

		const result = createEvent(sources, actorOf(a), BODY, NOW);

		expect(result).toMatchObject({ ok: true, event: { title: '歯医者', repeat: null } });
		if (!result.ok) return;
		expect(sources.userEvents.get(result.event.id, a)).toMatchObject({ visibility: 'private' });
		expect(sources.activity.listRecent(a)).toMatchObject([
			{
				action: 'event.create',
				targetId: result.event.id,
				tokenId: 3,
				tokenName: '手元の Claude Desktop',
				summary: '予定「歯医者」を足した',
			},
		]);
	});

	it('誤った入力は、画面と同じ文で断り、何も足さず、履歴にも残さない', () => {
		const { sources, user, actorOf } = setup();
		const a = user('a');

		const result = createEvent(sources, actorOf(a), { ...BODY, title: '' }, NOW);

		expect(result).toEqual({ ok: false, kind: 'invalid', error: '予定の名前を入れてください。' });
		expect(sources.userEvents.listByOwner(a)).toEqual([]);
		expect(sources.activity.listRecent(a)).toEqual([]);
	});

	it('直しても、公開範囲は変えない', () => {
		const { sources, user, actorOf } = setup();
		const a = user('a');
		const id = sources.userEvents.create(
			a,
			{
				title: '勉強会',
				location: null,
				notes: null,
				startDate: '2026-10-20',
				endDate: '2026-10-20',
				time: { kind: 'allDay' },
				rrule: null,
				excludedDates: [],
				visibility: 'public',
			},
			NOW,
		);

		const result = replaceEvent(
			sources,
			actorOf(a),
			id,
			{ ...BODY, title: '勉強会 (場所変更)' },
			NOW,
		);

		expect(result).toMatchObject({ ok: true, event: { id, title: '勉強会 (場所変更)' } });
		expect(sources.userEvents.get(id, a)).toMatchObject({ visibility: 'public' });
		expect(sources.activity.listRecent(a)[0]).toMatchObject({
			action: 'event.update',
			summary: '予定「勉強会 (場所変更)」を直した',
		});
	});

	it('ほかの人の予定は、見つからないことにして、直さない', () => {
		const { sources, user, actorOf } = setup();
		const a = user('a');
		const b = user('b');
		const created = createEvent(sources, actorOf(a), BODY, NOW);
		if (!created.ok) throw new Error('足せるはず');

		expect(replaceEvent(sources, actorOf(b), created.event.id, BODY, NOW)).toEqual({
			ok: false,
			kind: 'not_found',
			error: '予定が見つかりません',
		});
		expect(getEvent(sources, b, created.event.id)).toBeNull();
		expect(sources.activity.listRecent(b)).toEqual([]);
	});

	it('消すと、招待も外れ、履歴には消した予定の名前が残る。ほかの人の予定は消せない', () => {
		const { sources, user, actorOf } = setup();
		const a = user('a');
		const b = user('b');
		const created = createEvent(sources, actorOf(a), BODY, NOW);
		if (!created.ok) throw new Error('足せるはず');
		sources.accessGrants.grant('event', created.event.id, 'friend@fun.ac.jp', NOW);

		expect(deleteEvent(sources, actorOf(b), created.event.id, NOW)).toMatchObject({
			ok: false,
			kind: 'not_found',
		});
		expect(deleteEvent(sources, actorOf(a), created.event.id, NOW)).toEqual({ ok: true });

		expect(sources.userEvents.get(created.event.id, a)).toBeNull();
		expect(sources.accessGrants.list('event', created.event.id)).toEqual([]);
		expect(sources.activity.listRecent(a)[0]).toMatchObject({
			action: 'event.delete',
			summary: '予定「歯医者」を消した',
		});
	});
});
