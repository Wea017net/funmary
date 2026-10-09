import { createAuthStore, createSettingsStore, type AuthUser, type Database } from '@funmary/db';
import { describe, expect, it } from 'vitest';
import {
	issueInvite,
	loadInviteStatus,
	readInviteSettings,
	revokeInvite,
	saveInviteSettings,
	toInviteCodeView,
	usableInviteCodes,
} from './invites.ts';
import { useTestDatabase } from '@funmary/db/testing';

let database: Database;
useTestDatabase('funmary-invites-', (db) => (database = db));

const NOW = new Date('2026-10-15T03:00:00Z');

function setup() {
	const deps = { auth: createAuthStore(database), settings: createSettingsStore(database) };
	const make = (sub: string, email: string, role: 'user' | 'admin'): AuthUser => {
		const id = deps.auth.createUser({ googleSub: sub, email, name: null, role }, NOW);
		return deps.auth.findUserById(id)!;
	};
	return {
		deps,
		admin: make('g-admin', 'admin@fun.ac.jp', 'admin'),
		taro: make('g-taro', 'taro@fun.ac.jp', 'user'),
	};
}

describe('招待コードの設定', () => {
	it('保存していなければ既定 (管理者のみ、月 5 つ) を使い、保存した値を読み戻せる', () => {
		const { deps } = setup();
		expect(readInviteSettings(deps.settings)).toEqual({ issuers: 'admin', monthlyLimit: 5 });
		saveInviteSettings(deps.settings, { issuers: 'anyone', monthlyLimit: 2 }, NOW);
		expect(readInviteSettings(deps.settings)).toEqual({ issuers: 'anyone', monthlyLimit: 2 });
	});

	it('保存された値の形が壊れていたら、既定の値を使う', () => {
		const { deps } = setup();
		deps.settings.set('invites', { issuers: 'everyone', monthlyLimit: -1 }, NOW);
		expect(readInviteSettings(deps.settings)).toEqual({ issuers: 'admin', monthlyLimit: 5 });
	});
});

describe('招待コードの発行', () => {
	it('管理者は、使用回数、期限、メモを決めて発行でき、コードは 1 回だけ返す', () => {
		const { deps, admin } = setup();
		const result = issueInvite(deps, admin, { maxUses: 3, days: 7, note: '研究室' }, NOW);
		if (result.kind !== 'issued') throw new Error(`発行できるはず: ${result.kind}`);
		expect(result.expiresAt).toEqual(new Date('2026-10-22T03:00:00Z'));
		expect(deps.auth.findInviteCode(result.code)).toMatchObject({ maxUses: 3, usedCount: 0 });
		expect(deps.auth.listInviteCodes()).toMatchObject([
			{ note: '研究室', maxUses: 3, createdByEmail: 'admin@fun.ac.jp' },
		]);
	});

	it('管理者は、期限なしでも発行できる', () => {
		const { deps, admin } = setup();
		const result = issueInvite(deps, admin, { maxUses: 1, days: null, note: null }, NOW);
		expect(result).toMatchObject({ kind: 'issued', expiresAt: null });
	});

	it('管理者のみのモードでは、管理者でない人は発行できない', () => {
		const { deps, taro } = setup();
		expect(issueInvite(deps, taro, { maxUses: 1, days: 30, note: null }, NOW)).toEqual({
			kind: 'not-allowed',
		});
		expect(deps.auth.listInviteCodes()).toEqual([]);
	});

	it('許可したユーザーのモードでは、権限を付けた人だけが発行できる', () => {
		const { deps, admin, taro } = setup();
		saveInviteSettings(deps.settings, { issuers: 'permitted', monthlyLimit: 5 }, NOW);
		expect(issueInvite(deps, taro, { maxUses: 1, days: 30, note: null }, NOW).kind).toBe(
			'not-allowed',
		);
		deps.auth.setPermission(taro.id, 'invite:create', true, admin.id, NOW);
		expect(issueInvite(deps, taro, { maxUses: 1, days: 30, note: null }, NOW).kind).toBe('issued');
	});

	it('管理者でない人のコードは、指定にかかわらず 1 回だけ使えて 30 日で切れ、月の上限まで発行できる', () => {
		const { deps, taro } = setup();
		saveInviteSettings(deps.settings, { issuers: 'anyone', monthlyLimit: 2 }, NOW);
		const first = issueInvite(deps, taro, { maxUses: 10, days: null, note: '友人' }, NOW);
		if (first.kind !== 'issued') throw new Error(`発行できるはず: ${first.kind}`);
		expect(first.expiresAt).toEqual(new Date('2026-11-14T03:00:00Z'));
		expect(deps.auth.findInviteCode(first.code)?.maxUses).toBe(1);

		expect(issueInvite(deps, taro, { maxUses: 1, days: 30, note: null }, NOW).kind).toBe('issued');
		expect(issueInvite(deps, taro, { maxUses: 1, days: 30, note: null }, NOW)).toEqual({
			kind: 'limit-reached',
			limit: 2,
		});
		expect(loadInviteStatus(deps, taro, NOW).issuance).toEqual({ kind: 'limit-reached', limit: 2 });

		// 日本時間で月が替わると、また発行できる
		const nextMonth = new Date('2026-10-31T15:00:00Z');
		expect(loadInviteStatus(deps, taro, nextMonth).issuance).toEqual({
			kind: 'member',
			remaining: 2,
		});
	});
});

describe('招待コードの取り消し', () => {
	it('自分が発行したコードは取り消せ、ほかの人のコードは取り消せない。管理者は全員のコードを取り消せる', () => {
		const { deps, admin, taro } = setup();
		saveInviteSettings(deps.settings, { issuers: 'anyone', monthlyLimit: 5 }, NOW);
		const issued = issueInvite(deps, admin, { maxUses: 1, days: 30, note: null }, NOW);
		if (issued.kind !== 'issued') throw new Error('発行できるはず');
		const id = deps.auth.findInviteCode(issued.code)!.id;

		expect(revokeInvite(deps, taro, id, NOW)).toBe(false);
		expect(deps.auth.findInviteCode(issued.code)?.revoked).toBe(false);
		expect(revokeInvite(deps, admin, id, NOW)).toBe(true);
		expect(deps.auth.findInviteCode(issued.code)?.revoked).toBe(true);

		const own = issueInvite(deps, taro, { maxUses: 1, days: 30, note: null }, NOW);
		if (own.kind !== 'issued') throw new Error('発行できるはず');
		expect(revokeInvite(deps, taro, deps.auth.findInviteCode(own.code)!.id, NOW)).toBe(true);
	});
});

describe('一覧に出すコードの状態', () => {
	const base = {
		id: 1,
		note: null,
		maxUses: 2,
		usedCount: 0,
		expiresAt: new Date('2026-10-20T00:00:00Z'),
		revoked: false,
		createdAt: new Date('2026-10-01T00:00:00Z'),
		createdBy: null,
		createdByEmail: null,
	};

	it('取り消し、使い切り、期限切れ、使える、の順に判定し、時刻は日本時間で出す', () => {
		expect(toInviteCodeView(base, NOW)).toMatchObject({
			state: 'active',
			expiresAt: '2026-10-20 09:00',
			createdAt: '2026-10-01 09:00',
		});
		expect(toInviteCodeView({ ...base, usedCount: 2 }, NOW).state).toBe('used-up');
		expect(toInviteCodeView(base, new Date('2026-10-20T00:00:00Z')).state).toBe('expired');
		expect(toInviteCodeView({ ...base, usedCount: 2, revoked: true }, NOW).state).toBe('revoked');
		expect(toInviteCodeView({ ...base, expiresAt: null }, NOW).expiresAt).toBeNull();
	});

	it('一覧には、まだ使えるコードだけを出す (使い切り、期限切れ、取り消し済みは出さない)', () => {
		const codes = [
			{ ...base, id: 1 },
			{ ...base, id: 2, usedCount: 2 },
			{ ...base, id: 3, expiresAt: new Date('2026-10-02T00:00:00Z') },
			{ ...base, id: 4, revoked: true },
			{ ...base, id: 5, expiresAt: null },
		];
		expect(usableInviteCodes(codes, NOW).map((code) => code.id)).toEqual([1, 5]);
	});
});
