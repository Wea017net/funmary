import type { UserEvent } from '@funmary/core';
import { describe, expect, it } from 'vitest';
import { summarizeEvent } from './event-summary.ts';

const base: UserEvent = {
	id: 3,
	title: '架空のサークル',
	location: null,
	notes: 'メモ',
	startDate: '2026-10-05',
	endDate: '2026-10-05',
	time: { kind: 'time', start: '18:00', end: '19:30' },
	rrule: null,
	excludedDates: [],
};

describe('summarizeEvent', () => {
	it('単発の予定は、日付と時間だけ。繰り返しはなし', () => {
		expect(summarizeEvent(base)).toEqual({
			id: 3,
			title: '架空のサークル',
			location: null,
			notes: 'メモ',
			when: '10/5 (月)',
			time: '18:00-19:30',
			repeat: null,
		});
	});

	it('数日にわたる予定は、期間で出す。繰り返しは、説明の文にする', () => {
		expect(
			summarizeEvent({ ...base, endDate: '2026-10-08', time: { kind: 'allDay' } }),
		).toMatchObject({ when: '10/5 (月) から 10/8 (木)', time: '終日' });
		expect(summarizeEvent({ ...base, rrule: 'FREQ=WEEKLY;BYDAY=MO,WE' }).repeat).toBe(
			'毎週 月、水',
		);
	});

	it('読み戻せない繰り返しは、繰り返しとだけ出す', () => {
		expect(summarizeEvent({ ...base, rrule: 'FREQ=HOURLY' }).repeat).toBe('繰り返し');
	});
});
