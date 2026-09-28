// 招待コードの発行と取り消し (設計書 8.2)。発行できるかどうかは @funmary/core の inviteIssuance で決める。
// 管理者でない人のコードは、指定にかかわらず 1 回だけ使えて 30 日で切れる。月の上限は、日本時間の暦の月で数える。
import {
	DEFAULT_INVITE_SETTINGS,
	INVITE_ISSUERS,
	MEMBER_INVITE_DAYS,
	MEMBER_INVITE_MAX_USES,
	inviteIssuance,
	jstDateTime,
	startOfJstMonth,
	type InviteIssuance,
	type InviteSettings,
} from '@funmary/core';
import type { AuthStore, AuthUser, InviteCodeSummary, SettingsStore } from '@funmary/db';
import * as v from 'valibot';

const SETTINGS_KEY = 'invites';
const DAY_MS = 24 * 60 * 60 * 1000;

const settingsSchema = v.strictObject({
	issuers: v.picklist(INVITE_ISSUERS),
	monthlyLimit: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100)),
});

export interface InviteDeps {
	readonly auth: AuthStore;
	readonly settings: SettingsStore;
}

/** 保存された設定。保存していないか、形が壊れていれば既定の値 */
export function readInviteSettings(settings: SettingsStore): InviteSettings {
	const parsed = v.safeParse(settingsSchema, settings.get(SETTINGS_KEY));
	return parsed.success ? parsed.output : DEFAULT_INVITE_SETTINGS;
}

export function saveInviteSettings(
	settings: SettingsStore,
	value: InviteSettings,
	now: Date,
): void {
	settings.set(SETTINGS_KEY, v.parse(settingsSchema, value), now);
}

export function loadInviteStatus(deps: InviteDeps, user: AuthUser, now: Date) {
	const settings = readInviteSettings(deps.settings);
	const issuance: InviteIssuance = inviteIssuance(
		{ role: user.role, permissions: deps.auth.listPermissions(user.id) },
		settings,
		deps.auth.countInviteCodesSince(user.id, startOfJstMonth(now)),
	);
	return { settings, issuance };
}

export interface InviteRequest {
	readonly maxUses: number;
	/** 有効期限までの日数。null なら期限なし (管理者だけが使える) */
	readonly days: number | null;
	readonly note: string | null;
}

export type IssueResult =
	| { readonly kind: 'issued'; readonly code: string; readonly expiresAt: Date | null }
	| { readonly kind: 'not-allowed' }
	| { readonly kind: 'limit-reached'; readonly limit: number };

export function issueInvite(
	deps: InviteDeps,
	user: AuthUser,
	request: InviteRequest,
	now: Date,
): IssueResult {
	const { issuance } = loadInviteStatus(deps, user, now);
	switch (issuance.kind) {
		case 'not-allowed':
		case 'limit-reached':
			return issuance;
		case 'admin':
		case 'member': {
			const isAdmin = issuance.kind === 'admin';
			const maxUses = isAdmin ? request.maxUses : MEMBER_INVITE_MAX_USES;
			const days = isAdmin ? request.days : MEMBER_INVITE_DAYS;
			const expiresAt = days === null ? null : new Date(now.getTime() + days * DAY_MS);
			const code = deps.auth.createInviteCode(
				{ maxUses, expiresAt, note: request.note, createdBy: user.id },
				now,
			);
			return { kind: 'issued', code, expiresAt };
		}
	}
}

/** 取り消したら true。管理者は全員のコードを、ほかの人は自分が発行したコードだけを取り消せる */
export function revokeInvite(deps: InviteDeps, user: AuthUser, id: number, now: Date): boolean {
	const codes = deps.auth.listInviteCodes(user.role === 'admin' ? {} : { createdBy: user.id });
	if (!codes.some((code) => code.id === id)) return false;
	deps.auth.revokeInviteCode(id, now);
	return true;
}

export type InviteState = 'active' | 'used-up' | 'expired' | 'revoked';

export interface InviteCodeView {
	readonly id: number;
	readonly note: string | null;
	readonly usedCount: number;
	readonly maxUses: number;
	/** 日本時間の "YYYY-MM-DD HH:MM"。期限がなければ null */
	readonly expiresAt: string | null;
	readonly createdAt: string;
	readonly createdByEmail: string | null;
	readonly state: InviteState;
}

/** 日本時間の "YYYY-MM-DD HH:MM" */
export const formatJstDateTime = (date: Date) => {
	const { date: day, time } = jstDateTime(date);
	return `${day} ${time}`;
};

/**
 * 画面の一覧に出すコード。使い切り、期限切れ、取り消し済みは出さない (DB には残し、誰の招待で登録したかは追える)
 */
export function usableInviteCodes(
	codes: readonly InviteCodeSummary[],
	now: Date,
): InviteCodeView[] {
	return codes.map((code) => toInviteCodeView(code, now)).filter((code) => code.state === 'active');
}

/** 画面に出す形。コードそのものは DB にないので含まれない */
export function toInviteCodeView(code: InviteCodeSummary, now: Date): InviteCodeView {
	const state: InviteState = code.revoked
		? 'revoked'
		: code.usedCount >= code.maxUses
			? 'used-up'
			: code.expiresAt && code.expiresAt <= now
				? 'expired'
				: 'active';
	return {
		id: code.id,
		note: code.note,
		usedCount: code.usedCount,
		maxUses: code.maxUses,
		expiresAt: code.expiresAt && formatJstDateTime(code.expiresAt),
		createdAt: formatJstDateTime(code.createdAt),
		createdByEmail: code.createdByEmail,
		state,
	};
}
