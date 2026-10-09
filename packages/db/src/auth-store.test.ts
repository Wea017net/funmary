import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthStore, SESSION_TTL_MS } from './auth-store.ts';
import { openDatabase, type Database } from './database.ts';
import { hashToken } from './secrets.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-auth-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const at = (iso: string) => new Date(iso);
const T0 = at('2026-10-01T00:00:00Z');

function newUser(store: ReturnType<typeof createAuthStore>, sub = 'g-1', email = 'taro@fun.ac.jp') {
	return store.createUser({ googleSub: sub, email, name: '山田 太郎', role: 'user' }, T0);
}

describe('利用者', () => {
	it('作って、Google の sub と ID の両方で引ける。ID は推測できない乱数', () => {
		const store = createAuthStore(database);
		const id = newUser(store);
		expect(id.length).toBeGreaterThanOrEqual(20);
		expect(store.findUserBySub('g-1')).toEqual({
			id,
			email: 'taro@fun.ac.jp',
			name: '山田 太郎',
			role: 'user',
			status: 'active',
			termsAcceptedVersion: null,
		});
		expect(store.findUserById(id)?.email).toBe('taro@fun.ac.jp');
		expect(store.findUserBySub('ない')).toBeNull();
		expect(newUser(store, 'g-2', 'b@fun.ac.jp')).not.toBe(id);
	});

	it('ログインしたときに、最後のログインの時刻と名前を更新し、必要なら管理者にする', () => {
		const store = createAuthStore(database);
		const id = newUser(store);
		store.recordLogin(id, at('2026-10-02T00:00:00Z'), { name: '山田 太郎 (更新)', role: 'admin' });
		expect(store.findUserById(id)).toMatchObject({ name: '山田 太郎 (更新)', role: 'admin' });
	});

	it('メールアドレスで引ける。大文字と小文字は区別しない', () => {
		const store = createAuthStore(database);
		const id = newUser(store);
		expect(store.findUserByEmail('Taro@FUN.ac.jp')?.id).toBe(id);
		expect(store.findUserByEmail('none@fun.ac.jp')).toBeNull();
	});

	it('権限の段階 (user、moderator、admin) を変えられる', () => {
		const store = createAuthStore(database);
		const id = newUser(store);
		store.setRole(id, 'moderator');
		expect(store.findUserById(id)?.role).toBe('moderator');
		store.setRole(id, 'user');
		expect(store.findUserById(id)?.role).toBe('user');
	});

	it('利用者を停止すると、その利用者のセッションもすべて消える', () => {
		const store = createAuthStore(database);
		const id = newUser(store);
		const token = store.createSession(id, T0);
		store.setStatus(id, 'suspended');
		expect(store.findUserById(id)?.status).toBe('suspended');
		expect(store.resolveSession(token, T0)).toBeNull();
	});
});

describe('セッション', () => {
	it('作ったときの ID (Cookie に渡す) は DB に保存されず、SHA-256 だけが保存される', () => {
		const store = createAuthStore(database);
		const id = newUser(store);
		const token = store.createSession(id, T0);
		const rows = database.sqlite.prepare('SELECT id_hash FROM sessions').all() as {
			id_hash: string;
		}[];
		expect(rows).toEqual([{ id_hash: hashToken(token) }]);
		expect(JSON.stringify(rows)).not.toContain(token);
	});

	it('有効なセッションから、利用者を引ける。知らない ID は null', () => {
		const store = createAuthStore(database);
		const id = newUser(store);
		const token = store.createSession(id, T0);
		expect(store.resolveSession(token, at('2026-10-05T00:00:00Z'))?.id).toBe(id);
		expect(store.resolveSession('でたらめ', T0)).toBeNull();
		expect(store.resolveSession('', T0)).toBeNull();
	});

	it('有効期限は 30 日。過ぎたら使えない', () => {
		const store = createAuthStore(database);
		const id = newUser(store);
		// 使うと期限が延びるので、境目は別々のセッションで確かめる
		const beforeExpiry = store.createSession(id, T0);
		const atExpiry = store.createSession(id, T0);
		expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
		expect(
			store.resolveSession(beforeExpiry, new Date(T0.getTime() + SESSION_TTL_MS - 1)),
		).not.toBeNull();
		expect(store.resolveSession(atExpiry, new Date(T0.getTime() + SESSION_TTL_MS))).toBeNull();
	});

	it('使うたびに有効期限を延ばす (30 日の間に使い続ければ切れない)', () => {
		const store = createAuthStore(database);
		const token = store.createSession(newUser(store), T0);
		let now = T0;
		for (let i = 0; i < 4; i++) {
			now = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000);
			expect(store.resolveSession(token, now)).not.toBeNull();
		}
		// 最後に使ってから 30 日使わなければ、切れる
		expect(store.resolveSession(token, new Date(now.getTime() + SESSION_TTL_MS))).toBeNull();
	});

	it('ログアウトで、そのセッションだけが消える', () => {
		const store = createAuthStore(database);
		const id = newUser(store);
		const a = store.createSession(id, T0);
		const b = store.createSession(id, T0);
		store.deleteSession(a);
		expect(store.resolveSession(a, T0)).toBeNull();
		expect(store.resolveSession(b, T0)).not.toBeNull();
	});

	it('期限の切れたセッションを掃除する', () => {
		const store = createAuthStore(database);
		const id = newUser(store);
		store.createSession(id, T0);
		const fresh = store.createSession(id, new Date(T0.getTime() + 20 * 24 * 60 * 60 * 1000));
		const removed = store.purgeExpiredSessions(new Date(T0.getTime() + SESSION_TTL_MS + 1));
		expect(removed).toBe(1);
		expect(store.resolveSession(fresh, new Date(T0.getTime() + SESSION_TTL_MS + 1))).not.toBeNull();
	});
});

describe('招待コード', () => {
	it('発行したコードは、SHA-256 だけを保存する。コードから状態を引ける', () => {
		const store = createAuthStore(database);
		const code = store.createInviteCode(
			{ maxUses: 3, expiresAt: at('2026-11-01T00:00:00Z'), note: '研究室' },
			T0,
		);
		expect(code.length).toBeGreaterThanOrEqual(20);
		const rows = database.sqlite.prepare('SELECT code_hash FROM invite_codes').all() as {
			code_hash: string;
		}[];
		expect(rows).toEqual([{ code_hash: hashToken(code) }]);
		expect(store.findInviteCode(code)).toMatchObject({
			maxUses: 3,
			usedCount: 0,
			expiresAt: at('2026-11-01T00:00:00Z'),
			revoked: false,
		});
		expect(store.findInviteCode('ない')).toBeNull();
	});

	it('取り消すと、状態が取り消し済みになる', () => {
		const store = createAuthStore(database);
		const code = store.createInviteCode({ maxUses: 1 }, T0);
		const state = store.findInviteCode(code)!;
		store.revokeInviteCode(state.id, T0);
		expect(store.findInviteCode(code)?.revoked).toBe(true);
	});
});

describe('登録 (利用者の作成と招待コードの使用)', () => {
	it('招待コードを使って登録すると、使用回数が 1 増え、誰の招待かが残る', () => {
		const store = createAuthStore(database);
		const inviter = newUser(store);
		const code = store.createInviteCode({ maxUses: 2, createdBy: inviter }, T0);
		const invite = store.findInviteCode(code)!;
		const result = store.registerUser(
			{ googleSub: 'g-2', email: 'hanako@fun.ac.jp', name: '花子', role: 'user' },
			{ inviteCodeId: invite.id },
			T0,
		);
		expect(result.kind).toBe('created');
		expect(store.findInviteCode(code)?.usedCount).toBe(1);
		const row = database.sqlite
			.prepare('SELECT invited_by, invite_code_id FROM users WHERE google_sub = ?')
			.get('g-2') as { invited_by: string; invite_code_id: number };
		expect(row).toEqual({ invited_by: inviter, invite_code_id: invite.id });
	});

	it('使い切ったコードでは登録できず、利用者も作られない (同時に 2 人が使っても上限を超えない)', () => {
		const store = createAuthStore(database);
		const code = store.createInviteCode({ maxUses: 1 }, T0);
		const invite = store.findInviteCode(code)!;
		const first = store.registerUser(
			{ googleSub: 'g-1', email: 'a@fun.ac.jp', name: null, role: 'user' },
			{ inviteCodeId: invite.id },
			T0,
		);
		const second = store.registerUser(
			{ googleSub: 'g-2', email: 'b@fun.ac.jp', name: null, role: 'user' },
			{ inviteCodeId: invite.id },
			T0,
		);
		expect(first.kind).toBe('created');
		expect(second).toEqual({ kind: 'invite-unavailable' });
		expect(store.findUserBySub('g-2')).toBeNull();
		expect(store.findInviteCode(code)?.usedCount).toBe(1);
	});

	it('期限切れや取り消し済みのコードでも、登録できない', () => {
		const store = createAuthStore(database);
		const expired = store.createInviteCode(
			{ maxUses: 5, expiresAt: at('2026-09-30T00:00:00Z') },
			T0,
		);
		const revoked = store.createInviteCode({ maxUses: 5 }, T0);
		store.revokeInviteCode(store.findInviteCode(revoked)!.id, T0);
		for (const [i, code] of [expired, revoked].entries()) {
			const result = store.registerUser(
				{ googleSub: `g-${i}`, email: `u${i}@fun.ac.jp`, name: null, role: 'user' },
				{ inviteCodeId: store.findInviteCode(code)!.id },
				T0,
			);
			expect(result).toEqual({ kind: 'invite-unavailable' });
		}
	});

	it('招待コードを使わない登録もできる (管理者、open)', () => {
		const store = createAuthStore(database);
		const result = store.registerUser(
			{ googleSub: 'g-1', email: 'a@fun.ac.jp', name: null, role: 'admin' },
			{ inviteCodeId: null },
			T0,
		);
		expect(result.kind).toBe('created');
		expect(store.findUserBySub('g-1')?.role).toBe('admin');
	});
});

describe('招待コードの一覧と、今月の発行数', () => {
	it('発行者とメモと利用状況の一覧を、新しい順に返す。発行者で絞れる', () => {
		const store = createAuthStore(database);
		const taro = newUser(store);
		const hanako = newUser(store, 'g-2', 'hanako@fun.ac.jp');
		store.createInviteCode({ maxUses: 1, note: '1 つ目', createdBy: taro }, T0);
		store.createInviteCode(
			{ maxUses: 3, note: '2 つ目', createdBy: hanako },
			at('2026-10-02T00:00:00Z'),
		);
		expect(store.listInviteCodes()).toMatchObject([
			{ note: '2 つ目', maxUses: 3, usedCount: 0, createdByEmail: 'hanako@fun.ac.jp' },
			{ note: '1 つ目', maxUses: 1, usedCount: 0, createdByEmail: 'taro@fun.ac.jp' },
		]);
		expect(store.listInviteCodes({ createdBy: taro })).toMatchObject([{ note: '1 つ目' }]);
	});

	it('指定した時刻より後に、その人が発行した数を数える (取り消したものも数える)', () => {
		const store = createAuthStore(database);
		const taro = newUser(store);
		store.createInviteCode({ maxUses: 1, createdBy: taro }, at('2026-09-30T00:00:00Z'));
		store.createInviteCode({ maxUses: 1, createdBy: taro }, at('2026-10-05T00:00:00Z'));
		const code = store.createInviteCode(
			{ maxUses: 1, createdBy: taro },
			at('2026-10-06T00:00:00Z'),
		);
		store.revokeInviteCode(store.findInviteCode(code)!.id, T0);
		store.createInviteCode({ maxUses: 1 }, at('2026-10-07T00:00:00Z'));
		expect(store.countInviteCodesSince(taro, at('2026-10-01T00:00:00Z'))).toBe(2);
	});
});

describe('利用者の権限', () => {
	it('権限を付けて外せる。付けた人と時刻を残し、同じ権限を 2 回付けても 1 つにする', () => {
		const store = createAuthStore(database);
		const admin = newUser(store, 'g-admin', 'admin@fun.ac.jp');
		const taro = newUser(store);
		expect(store.listPermissions(taro)).toEqual([]);
		store.setPermission(taro, 'invite:create', true, admin, T0);
		store.setPermission(taro, 'invite:create', true, admin, T0);
		expect(store.listPermissions(taro)).toEqual(['invite:create']);
		store.setPermission(taro, 'invite:create', false, admin, T0);
		expect(store.listPermissions(taro)).toEqual([]);
	});

	it('利用者の一覧に、それぞれの権限を付けて返す', () => {
		const store = createAuthStore(database);
		const taro = newUser(store);
		newUser(store, 'g-2', 'hanako@fun.ac.jp');
		store.setPermission(taro, 'invite:create', true, null, T0);
		expect(store.listUsers()).toMatchObject([
			{ email: 'hanako@fun.ac.jp', role: 'user', status: 'active', permissions: [] },
			{ email: 'taro@fun.ac.jp', role: 'user', status: 'active', permissions: ['invite:create'] },
		]);
	});
});

describe('利用規約への同意', () => {
	it('作ったばかりの利用者は、どの版にも同意していない', () => {
		const store = createAuthStore(database);
		const id = store.createUser(
			{ googleSub: 'a', email: 'a@fun.ac.jp', name: null, role: 'user' },
			T0,
		);

		expect(store.findUserById(id)?.termsAcceptedVersion).toBeNull();
	});

	it('同意すると、その版を覚え、セッションから引いた利用者にも出る', () => {
		const store = createAuthStore(database);
		const id = store.createUser(
			{ googleSub: 'a', email: 'a@fun.ac.jp', name: null, role: 'user' },
			T0,
		);

		store.acceptTerms(id, '2026-10-03', T0);

		expect(store.findUserById(id)?.termsAcceptedVersion).toBe('2026-10-03');
		const session = store.createSession(id, T0);
		expect(store.resolveSession(session, T0)?.termsAcceptedVersion).toBe('2026-10-03');
	});

	it('新しい版に同意し直すと、新しい版になる。同じ版を続けて記録しても壊れない', () => {
		const store = createAuthStore(database);
		const id = store.createUser(
			{ googleSub: 'a', email: 'a@fun.ac.jp', name: null, role: 'user' },
			T0,
		);

		store.acceptTerms(id, '2026-10-03', T0);
		store.acceptTerms(id, '2026-10-03', T0);
		store.acceptTerms(id, '2026-11-01', T0);

		expect(store.findUserById(id)?.termsAcceptedVersion).toBe('2026-11-01');
	});
});
