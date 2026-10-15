import { type AccessTokenScope, type Database } from '@funmary/db';
import { useTestDatabase } from '@funmary/db/testing';
import { describe, expect, it } from 'vitest';
import { createTestApiDeps } from '../testing.ts';
import { createV1Routes } from './routes.ts';

let database: Database;
useTestDatabase('funmary-v1-course-write-', (db) => (database = db));

const NOW = new Date();

function setup() {
	const src = createTestApiDeps(database);
	const app = createV1Routes(src);
	const user = (sub: string) =>
		src.users.createUser(
			{ googleSub: sub, email: `${sub}@fun.ac.jp`, name: null, role: 'user' },
			NOW,
		);
	const tokenFor = (userId: string, scopes: AccessTokenScope[], name = '手元のスクリプト') =>
		src.accessTokens.issue(userId, { name, scopes }, new Date(NOW.getTime() + 86_400_000), NOW);
	const call = (token: string, method: string, path: string, body?: unknown) =>
		app.request(path, {
			method,
			headers: {
				Authorization: `Bearer ${token}`,
				...(body === undefined ? {} : { 'content-type': 'application/json' }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	const base = {
		academicYear: 2026,
		credits: 2,
		teacher: null,
		term: 'fall' as const,
		attributes: {},
		syllabus: {},
		syllabusUrl: null,
	};
	src.subjects.upsert({ ...base, syllabusId: '100', name: '線形代数' }, NOW);
	src.subjects.upsert({ ...base, syllabusId: '200', name: '情報アーキテクチャ' }, NOW);
	src.subjects.upsert({ ...base, syllabusId: '201', name: '情報アーキテクチャ' }, NOW);
	const a = user('a');
	return { src, user, tokenFor, call, a, token: tokenFor(a, ['write:courses'], '手元の Claude') };
}

describe('履修の書き込み (REST)', () => {
	it('write:courses がなければ、書き込めない', async () => {
		const { tokenFor, call, a } = setup();
		const readOnly = tokenFor(a, ['read:lessons']);
		const body = { academicYear: 2026, syllabusId: '100' };
		expect((await call(readOnly, 'POST', '/api/v1/courses', body)).status).toBe(403);
		expect((await call(readOnly, 'DELETE', '/api/v1/courses/2026/100')).status).toBe(403);
	});

	it('年度とシラバスの番号で登録でき、履歴にトークンの名前が残る', async () => {
		const { src, call, a, token } = setup();

		const res = await call(token, 'POST', '/api/v1/courses', {
			academicYear: 2026,
			syllabusId: '100',
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			subject: { name: '線形代数', syllabusId: '100' },
			registered: true,
			personalSlots: [],
		});
		expect(src.activity.listRecent(a)).toMatchObject([
			{ action: 'course.register', tokenName: '手元の Claude' },
		]);
	});

	it('名前でも登録できる。複数に当たったら、409 で候補を返し、登録しない', async () => {
		const { src, call, a, token } = setup();

		expect((await call(token, 'POST', '/api/v1/courses', { name: '線形' })).status).toBe(200);

		const ambiguous = await call(token, 'POST', '/api/v1/courses', { name: '情報アーキテクチャ' });
		expect(ambiguous.status).toBe(409);
		expect(await ambiguous.json()).toMatchObject({
			error: 'ambiguous',
			candidates: [{ syllabusId: '200' }, { syllabusId: '201' }],
		});
		expect(src.courses.listRegistrations(a)).toHaveLength(1);
	});

	it('指し方が足りなければ 400、ない科目と、登録していない科目の解除は 404', async () => {
		const { call, token } = setup();
		expect((await call(token, 'POST', '/api/v1/courses', {})).status).toBe(400);
		expect((await call(token, 'POST', '/api/v1/courses', { name: '存在しない' })).status).toBe(404);
		expect((await call(token, 'DELETE', '/api/v1/courses/2026/100')).status).toBe(404);
	});

	it('自分だけの曜日と時限を足して消せる。履修していなければ 409、範囲の外なら 400', async () => {
		const { call, token } = setup();
		const slot = { weekday: 2, period: 3, room: '363' };
		const path = '/api/v1/courses/2026/100/personal-slots';

		expect((await call(token, 'PUT', path, slot)).status).toBe(409);
		await call(token, 'POST', '/api/v1/courses', { academicYear: 2026, syllabusId: '100' });
		expect((await call(token, 'PUT', path, { ...slot, weekday: 9 })).status).toBe(400);

		const res = await call(token, 'PUT', path, slot);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ personalSlots: [slot] });

		const removed = await call(token, 'DELETE', `${path}/2/3`);
		expect(await removed.json()).toMatchObject({ personalSlots: [] });
		expect((await call(token, 'DELETE', `${path}/2/3`)).status).toBe(404);
	});

	it('略称を保存できる。長すぎれば 400', async () => {
		const { call, token } = setup();
		const path = '/api/v1/courses/2026/100/abbreviation';

		const res = await call(token, 'PUT', path, { abbreviation: '線代' });
		expect(await res.json()).toMatchObject({ abbreviation: '線代' });
		expect((await call(token, 'PUT', path, { abbreviation: 'あ'.repeat(101) })).status).toBe(400);
	});

	it('解除は、自分の履修にだけ効く', async () => {
		const { src, call, a, token, user, tokenFor } = setup();
		const ref = { academicYear: 2026, syllabusId: '100' };
		await call(token, 'POST', '/api/v1/courses', ref);
		const b = user('b');
		await call(tokenFor(b, ['write:courses']), 'POST', '/api/v1/courses', ref);

		const res = await call(token, 'DELETE', '/api/v1/courses/2026/100');

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ registered: false });
		expect(src.courses.listRegistrations(a)).toEqual([]);
		expect(src.courses.listRegistrations(b)).toHaveLength(1);
	});
});
