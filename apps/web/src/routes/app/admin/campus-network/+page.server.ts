// 学内の Wi-Fi の IP アドレスの範囲 (#359)。バスの向きをはじめに決めるのに使う。
// 開いている人のいまのアドレスと、登録済みかを出し、そのアドレスの登録、範囲の入力による登録、削除ができる
import { fail, type Actions, type ServerLoad } from '@sveltejs/kit';
import { jstDateTime } from '@funmary/core';
import { requireAdmin } from '#lib/server/admin.ts';
import {
	CAMPUS_RANGES_KEY,
	addRegisteredRange,
	describeAddress,
	parseCurrentAddressForm,
	parseRangeForm,
	readRegisteredRanges,
	removeRegisteredRange,
	type RegisteredRange,
} from '#lib/server/campus-networks.ts';
import { getServices } from '#lib/server/services.ts';

const readList = () => readRegisteredRanges(getServices().settings.get(CAMPUS_RANGES_KEY));
const saveList = (list: RegisteredRange[]) =>
	getServices().settings.set(CAMPUS_RANGES_KEY, list, new Date());

/** 接続元のアドレス。リバースプロキシの設定が足りないなどで読めないときは null */
function clientAddress(getClientAddress: () => string): string | null {
	try {
		return getClientAddress();
	} catch {
		return null;
	}
}

export const load: ServerLoad = ({ locals, getClientAddress }) => {
	requireAdmin(locals);
	const { campus } = getServices();
	const registered = readList();
	const address = clientAddress(getClientAddress);
	const status = address
		? describeAddress(address, campus.envRanges, registered)
		: { ipv4: null, match: null };
	return {
		address,
		ipv4: status.ipv4,
		match: status.match,
		envRanges: [...campus.envRanges],
		ranges: registered.map((entry) => {
			const { date, time } = jstDateTime(new Date(entry.createdAt));
			return {
				id: entry.id,
				range: entry.range,
				label: entry.label,
				createdAt: `${date} ${time}`,
			};
		}),
	};
};

export const actions: Actions = {
	/** いまのアドレスを登録する (そのアドレスだけ、または同じ /24) */
	registerCurrent: async ({ request, locals, getClientAddress }) => {
		requireAdmin(locals);
		const { campus } = getServices();
		const address = clientAddress(getClientAddress);
		if (!address) return fail(400, { error: '接続元のアドレスを読めませんでした。' });
		const list = readList();
		const status = describeAddress(address, campus.envRanges, list);
		if (status.match) {
			return fail(400, { error: `このアドレスは、すでに ${status.match.range} に入っています。` });
		}
		const parsed = parseCurrentAddressForm(await request.formData(), address);
		if (!parsed.ok) return fail(400, { error: parsed.error });
		const added = addRegisteredRange(list, campus.envRanges, parsed.value, new Date());
		if (!added.ok) return fail(400, { error: added.error });
		saveList(added.value);
		return { message: `${parsed.value.range} を登録しました。` };
	},
	/** 範囲を入力して登録する */
	register: async ({ request, locals }) => {
		requireAdmin(locals);
		const parsed = parseRangeForm(await request.formData());
		if (!parsed.ok) return fail(400, { error: parsed.error });
		const added = addRegisteredRange(
			readList(),
			getServices().campus.envRanges,
			parsed.value,
			new Date(),
		);
		if (!added.ok) return fail(400, { error: added.error });
		saveList(added.value);
		return { message: `${parsed.value.range} を登録しました。` };
	},
	remove: async ({ request, locals }) => {
		requireAdmin(locals);
		const id = (await request.formData()).get('id');
		const list = readList();
		const target = list.find((entry) => entry.id === id);
		if (!target) return fail(404, { error: '登録した範囲が見つかりません。' });
		saveList(removeRegisteredRange(list, target.id));
		return { message: `${target.range} の登録を消しました。` };
	},
};
