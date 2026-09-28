import type { UserEvent } from '@funmary/core';
import { describe, expect, it } from 'vitest';
import { parseEventForm, toFormValues } from './event-form.ts';

/** ブラウザが送る形にそろえた FormData。同じ名前を複数持てる */
function form(fields: Record<string, string | string[]>): FormData {
	const data = new FormData();
	for (const [name, value] of Object.entries(fields)) {
		for (const item of Array.isArray(value) ? value : [value]) data.append(name, item);
	}
	return data;
}

const base = {
	title: '架空のサークル',
	location: '架空の部室',
	notes: '',
	startDate: '2026-10-05',
	endDate: '',
	timeKind: 'time',
	startTime: '18:00',
	endTime: '19:30',
	repeat: 'none',
};

describe('parseEventForm: 予定の基本', () => {
	it('単発の予定を読む。終了日が空なら、開始日と同じ。空のメモと場所は null', () => {
		const result = parseEventForm(form({ ...base, location: '', notes: ' ' }));
		expect(result).toEqual({
			ok: true,
			value: {
				title: '架空のサークル',
				location: null,
				notes: null,
				startDate: '2026-10-05',
				endDate: '2026-10-05',
				time: { kind: 'time', start: '18:00', end: '19:30' },
				rrule: null,
				excludedDates: [],
			},
		});
	});

	it('名前がない、長すぎる、日付が誤っている、終わりが始まりより前のときは、理由を返す', () => {
		for (const fields of [
			{ ...base, title: ' ' },
			{ ...base, title: 'あ'.repeat(101) },
			{ ...base, startDate: '2026-02-30' },
			{ ...base, startDate: '' },
			{ ...base, endDate: '2026-10-04' },
		]) {
			expect(parseEventForm(form(fields))).toMatchObject({ ok: false });
		}
	});

	it('時限を選んだ予定は、from と to を読む。to が from より前だと、誤り', () => {
		const ok = parseEventForm(
			form({ ...base, timeKind: 'period', startPeriod: '2', endPeriod: '3' }),
		);
		expect(ok).toMatchObject({ ok: true, value: { time: { kind: 'period', from: 2, to: 3 } } });
		expect(
			parseEventForm(form({ ...base, timeKind: 'period', startPeriod: '3', endPeriod: '2' })),
		).toMatchObject({ ok: false });
		expect(
			parseEventForm(form({ ...base, timeKind: 'period', startPeriod: '7', endPeriod: '7' })),
		).toMatchObject({ ok: false });
	});

	it('時刻は、終わりが始まりより後でなければ誤り。終日には、時刻は要らない', () => {
		expect(parseEventForm(form({ ...base, startTime: '19:00', endTime: '18:00' }))).toMatchObject({
			ok: false,
		});
		expect(parseEventForm(form({ ...base, startTime: '25:00' }))).toMatchObject({ ok: false });
		expect(
			parseEventForm(form({ ...base, timeKind: 'allDay', startTime: '', endTime: '' })),
		).toMatchObject({ ok: true, value: { time: { kind: 'allDay' } } });
	});

	it('数日にわたる予定は、終日だけ選べる。長すぎる期間は誤り', () => {
		expect(parseEventForm(form({ ...base, endDate: '2026-10-07' }))).toMatchObject({ ok: false });
		expect(
			parseEventForm(form({ ...base, endDate: '2026-10-07', timeKind: 'allDay' })),
		).toMatchObject({ ok: true, value: { endDate: '2026-10-07' } });
		expect(
			parseEventForm(form({ ...base, endDate: '2027-10-07', timeKind: 'allDay' })),
		).toMatchObject({ ok: false });
	});
});

describe('parseEventForm: 繰り返し', () => {
	it('毎週は、選んだ曜日と間隔を RRULE にする', () => {
		const result = parseEventForm(
			form({ ...base, repeat: 'weekly', interval: '2', weekday: ['1', '3'], endKind: 'never' }),
		);
		expect(result).toMatchObject({
			ok: true,
			value: { rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE' },
		});
	});

	it('毎月は、日付、第何曜日、最終の曜日から選ぶ。第何曜日は、開始日から決める', () => {
		const monthly = (mode: string, startDate: string) =>
			parseEventForm(
				form({ ...base, startDate, repeat: 'monthly', monthlyMode: mode, endKind: 'never' }),
			);
		expect(monthly('day', '2026-10-15')).toMatchObject({
			value: { rrule: 'FREQ=MONTHLY;BYMONTHDAY=15' },
		});
		expect(monthly('nth', '2026-10-13')).toMatchObject({
			value: { rrule: 'FREQ=MONTHLY;BYDAY=2TU' },
		});
		expect(monthly('last', '2026-10-30')).toMatchObject({
			value: { rrule: 'FREQ=MONTHLY;BYDAY=-1FR' },
		});
	});

	it('終わりは、なし、日付まで、回数から選ぶ。日付は開始日以降、回数は 1 から 999', () => {
		const withEnd = (extra: Record<string, string>) =>
			parseEventForm(form({ ...base, repeat: 'daily', ...extra }));
		expect(withEnd({ endKind: 'count', count: '5' })).toMatchObject({
			value: { rrule: 'FREQ=DAILY;COUNT=5' },
		});
		expect(withEnd({ endKind: 'until', untilDate: '2026-12-31' })).toMatchObject({
			value: { rrule: 'FREQ=DAILY;UNTIL=20261231' },
		});
		expect(withEnd({ endKind: 'until', untilDate: '2026-10-01' })).toMatchObject({ ok: false });
		expect(withEnd({ endKind: 'count', count: '0' })).toMatchObject({ ok: false });
		expect(withEnd({ endKind: 'count', count: '1000' })).toMatchObject({ ok: false });
	});

	it('間隔は 1 から 99 まで', () => {
		expect(parseEventForm(form({ ...base, repeat: 'daily', interval: '0' }))).toMatchObject({
			ok: false,
		});
		expect(parseEventForm(form({ ...base, repeat: 'daily', interval: '100' }))).toMatchObject({
			ok: false,
		});
	});

	it('除く日は、正しい日付だけを、重複なく残す。繰り返さない予定には付けない', () => {
		const repeating = parseEventForm(
			form({
				...base,
				repeat: 'weekly',
				weekday: '1',
				exclude: ['2026-10-12', '2026-10-12', 'x', '2026-13-01'],
			}),
		);
		expect(repeating).toMatchObject({ value: { excludedDates: ['2026-10-12'] } });
		expect(parseEventForm(form({ ...base, exclude: ['2026-10-12'] }))).toMatchObject({
			value: { excludedDates: [] },
		});
	});
});

describe('toFormValues: 編集の画面に、保存した予定の値を戻す', () => {
	const event: UserEvent = {
		id: 7,
		title: '架空のサークル',
		location: null,
		notes: 'メモ',
		startDate: '2026-10-13',
		endDate: '2026-10-13',
		time: { kind: 'period', from: 2, to: 3 },
		rrule: 'FREQ=MONTHLY;BYDAY=2TU;COUNT=6',
		excludedDates: ['2026-11-10'],
	};

	it('繰り返し、時間、除く日を、フォームの値の形に戻す', () => {
		expect(toFormValues(event)).toMatchObject({
			title: '架空のサークル',
			location: '',
			notes: 'メモ',
			startDate: '2026-10-13',
			endDate: '',
			timeKind: 'period',
			startPeriod: '2',
			endPeriod: '3',
			repeat: 'monthly',
			interval: '1',
			monthlyMode: 'nth',
			endKind: 'count',
			count: '6',
			excludedDates: ['2026-11-10'],
		});
	});

	it('保存した値を、フォームに戻して読み直しても、同じ予定になる', () => {
		const values = toFormValues(event);
		const data = new FormData();
		for (const name of [
			'title',
			'location',
			'notes',
			'startDate',
			'endDate',
			'timeKind',
			'startPeriod',
			'endPeriod',
			'repeat',
			'interval',
			'monthlyMode',
			'endKind',
			'count',
		] as const) {
			data.set(name, values[name]);
		}
		for (const date of values.excludedDates) data.append('exclude', date);
		// id は、フォームにない。undefined の項目は、toEqual では無いものとして比べられる
		expect(parseEventForm(data)).toEqual({ ok: true, value: { ...event, id: undefined } });
	});

	it('読み戻せない繰り返しは、繰り返しなしとして戻す', () => {
		expect(toFormValues({ ...event, rrule: 'FREQ=HOURLY' }).repeat).toBe('none');
	});
});
