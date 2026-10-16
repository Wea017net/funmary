// 学内の Wi-Fi の IP アドレスの範囲 (#359)。バスの画面が、向きをはじめに決めるのに使う。
// 環境変数 CAMPUS_IP_RANGES の範囲に加えて、管理者が画面から登録した範囲を、DB の settings に置く
import { randomUUID } from 'node:crypto';
import { findIpRange, ipRangeContaining, normalizeIpRange } from '@funmary/core';

/** 登録した範囲の一覧を保存する設定の名前 */
export const CAMPUS_RANGES_KEY = 'campus-ip-ranges';

const MAX_RECORDS = 50;
const MAX_LABEL_LENGTH = 100;

export interface RegisteredRange {
	readonly id: string;
	/** normalizeIpRange でそろえた形 */
	readonly range: string;
	readonly label: string | null;
	readonly createdAt: string;
}

type FormResult<T> = { ok: true; value: T } | { ok: false; error: string };

function isRegisteredRange(value: unknown): value is RegisteredRange {
	if (typeof value !== 'object' || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v['id'] === 'string' &&
		typeof v['range'] === 'string' &&
		normalizeIpRange(v['range']) === v['range'] &&
		(v['label'] === null || typeof v['label'] === 'string') &&
		typeof v['createdAt'] === 'string'
	);
}

export function readRegisteredRanges(value: unknown): RegisteredRange[] {
	return Array.isArray(value) ? value.filter(isRegisteredRange) : [];
}

/** 学内として扱う範囲すべて。環境変数のものを先に、重複は除く */
export function campusRanges(
	envRanges: readonly string[],
	registered: readonly RegisteredRange[],
): string[] {
	const all = [...envRanges, ...registered.map((entry) => entry.range)];
	return [...new Set(all.map((range) => normalizeIpRange(range) ?? range))];
}

export interface AddressStatus {
	/** IPv4 のアドレス。IPv4 でなければ null (登録できない) */
	readonly ipv4: string | null;
	/** 入っている範囲。登録のものなら id も入る。入っていなければ null */
	readonly match: { range: string; source: 'env' | 'registered'; id: string | null } | null;
}

/** アドレスが、すでに学内の範囲に入っているか。ボタンを押す前から画面に出すのに使う */
export function describeAddress(
	address: string,
	envRanges: readonly string[],
	registered: readonly RegisteredRange[],
): AddressStatus {
	const ipv4 = ipRangeContaining(address, 32);
	if (ipv4 === null) return { ipv4: null, match: null };
	const fromEnv = findIpRange(
		ipv4,
		envRanges.map((range) => normalizeIpRange(range) ?? range),
	);
	if (fromEnv !== null) return { ipv4, match: { range: fromEnv, source: 'env', id: null } };
	const found = registered.find((entry) => findIpRange(ipv4, [entry.range]) !== null);
	return {
		ipv4,
		match: found ? { range: found.range, source: 'registered', id: found.id } : null,
	};
}

export function addRegisteredRange(
	list: readonly RegisteredRange[],
	envRanges: readonly string[],
	input: { readonly range: string; readonly label: string | null },
	now: Date,
): FormResult<RegisteredRange[]> {
	if (campusRanges(envRanges, list).includes(input.range)) {
		return { ok: false, error: 'この範囲は、すでに登録してあります。' };
	}
	if (list.length >= MAX_RECORDS) {
		return {
			ok: false,
			error: `登録できるのは ${MAX_RECORDS} 件までです。使わない範囲を消してください。`,
		};
	}
	const added: RegisteredRange = {
		id: randomUUID(),
		range: input.range,
		label: input.label,
		createdAt: now.toISOString(),
	};
	return { ok: true, value: [added, ...list] };
}

export const removeRegisteredRange = (
	list: readonly RegisteredRange[],
	id: string,
): RegisteredRange[] => list.filter((entry) => entry.id !== id);

const readLabel = (form: FormData): FormResult<string | null> => {
	const raw = form.get('label');
	const label = typeof raw === 'string' ? raw.trim() : '';
	if (label.length > MAX_LABEL_LENGTH) {
		return { ok: false, error: `メモは ${MAX_LABEL_LENGTH} 文字までにしてください。` };
	}
	return { ok: true, value: label === '' ? null : label };
};

/** 範囲を手で入れるフォーム */
export function parseRangeForm(
	form: FormData,
): FormResult<{ range: string; label: string | null }> {
	const raw = form.get('range');
	const range = typeof raw === 'string' ? normalizeIpRange(raw) : null;
	if (range === null) {
		return {
			ok: false,
			error:
				'IPv4 のアドレスか、203.0.113.0/24 の形の範囲を入れてください (/8 より広い範囲は登録できません)。',
		};
	}
	const label = readLabel(form);
	if (!label.ok) return label;
	return { ok: true, value: { range, label: label.value } };
}

/** いまのアドレスを登録するフォーム。bits は、そのアドレスだけ (32) か、同じ /24 (24) */
export function parseCurrentAddressForm(
	form: FormData,
	address: string,
): FormResult<{ range: string; label: string | null }> {
	const bits = form.get('bits');
	const range = bits === '32' || bits === '24' ? ipRangeContaining(address, Number(bits)) : null;
	if (range === null) {
		return { ok: false, error: 'IPv4 のアドレスでないので、登録できません。' };
	}
	return { ok: true, value: { range, label: null } };
}
