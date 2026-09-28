import { describe, expect, it } from 'vitest';
import { DEFAULT_INVITE_SETTINGS, inviteIssuance, startOfJstMonth } from './invites.ts';

const admin = { role: 'admin', permissions: [] } as const;
const permitted = { role: 'user', permissions: ['invite:create'] } as const;
const member = { role: 'user', permissions: [] } as const;

describe('inviteIssuance', () => {
	it('既定は管理者のみで、管理者は上限なく発行できる', () => {
		expect(DEFAULT_INVITE_SETTINGS).toEqual({ issuers: 'admin', monthlyLimit: 5 });
		expect(inviteIssuance(admin, DEFAULT_INVITE_SETTINGS, 100)).toEqual({ kind: 'admin' });
		expect(inviteIssuance(permitted, DEFAULT_INVITE_SETTINGS, 0)).toEqual({
			kind: 'not-allowed',
		});
		expect(inviteIssuance(member, DEFAULT_INVITE_SETTINGS, 0)).toEqual({ kind: 'not-allowed' });
	});

	it('許可したユーザーのモードでは、発行の権限を持つ人だけが、月の上限まで発行できる', () => {
		const settings = { issuers: 'permitted', monthlyLimit: 3 } as const;
		expect(inviteIssuance(permitted, settings, 1)).toEqual({ kind: 'member', remaining: 2 });
		expect(inviteIssuance(member, settings, 0)).toEqual({ kind: 'not-allowed' });
		expect(inviteIssuance(admin, settings, 10)).toEqual({ kind: 'admin' });
	});

	it('誰でものモードでは、全員が月の上限まで発行できる', () => {
		const settings = { issuers: 'anyone', monthlyLimit: 2 } as const;
		expect(inviteIssuance(member, settings, 0)).toEqual({ kind: 'member', remaining: 2 });
		expect(inviteIssuance(member, settings, 2)).toEqual({ kind: 'limit-reached', limit: 2 });
		expect(inviteIssuance(member, settings, 5)).toEqual({ kind: 'limit-reached', limit: 2 });
	});

	it('月の上限が 0 なら、管理者でない人は発行できない', () => {
		const settings = { issuers: 'anyone', monthlyLimit: 0 } as const;
		expect(inviteIssuance(member, settings, 0)).toEqual({ kind: 'limit-reached', limit: 0 });
	});
});

describe('startOfJstMonth', () => {
	it('日本時間の月初 (1 日の 0 時) を返す', () => {
		expect(startOfJstMonth(new Date('2026-09-28T03:00:00Z'))).toEqual(
			new Date('2026-08-31T15:00:00Z'),
		);
	});

	it('UTC ではまだ前の月でも、日本時間で月が替わっていれば、新しい月の初めを返す', () => {
		// 日本時間の 2026-10-01 00:30
		expect(startOfJstMonth(new Date('2026-09-30T15:30:00Z'))).toEqual(
			new Date('2026-09-30T15:00:00Z'),
		);
	});

	it('1 月は、前の年の 12 月の続きにしない', () => {
		expect(startOfJstMonth(new Date('2027-01-15T00:00:00Z'))).toEqual(
			new Date('2026-12-31T15:00:00Z'),
		);
	});
});
