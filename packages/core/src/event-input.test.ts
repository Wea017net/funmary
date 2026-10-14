import { describe, expect, it } from 'vitest';
import { parseEventFields, type EventFieldReader } from './event-input.ts';

/** FormData でなく、欄の名前と値の表から作る入力 (公開 API が使う形) */
const reader = (fields: Record<string, string | string[]>): EventFieldReader => ({
	get: (name) => {
		const value = fields[name];
		return Array.isArray(value) ? value[0] : value;
	},
	getAll: (name) => {
		const value = fields[name];
		return value === undefined ? [] : Array.isArray(value) ? value : [value];
	},
});

describe('予定の入力の検査', () => {
	it('FormData でなくても、欄の名前で値を引ける入力なら、予定にできる', () => {
		const result = parseEventFields(
			reader({
				title: '歯医者',
				startDate: '2026-10-20',
				timeKind: 'time',
				startTime: '10:00',
				endTime: '11:00',
			}),
		);

		expect(result).toEqual({
			ok: true,
			value: {
				title: '歯医者',
				location: null,
				notes: null,
				startDate: '2026-10-20',
				endDate: '2026-10-20',
				time: { kind: 'time', start: '10:00', end: '11:00' },
				rrule: null,
				excludedDates: [],
				visibility: 'private',
			},
		});
	});

	it('公開範囲が空や知らない値なら、非公開にする', () => {
		const result = parseEventFields(
			reader({ title: 'a', startDate: '2026-10-20', timeKind: 'allDay', visibility: 'everyone' }),
		);

		expect(result).toMatchObject({ ok: true, value: { visibility: 'private' } });
	});

	it('誤りは、直し方が分かる文で返す', () => {
		expect(
			parseEventFields(reader({ title: '', startDate: '2026-10-20', timeKind: 'allDay' })),
		).toEqual({
			ok: false,
			error: '予定の名前を入れてください。',
		});
	});
});
