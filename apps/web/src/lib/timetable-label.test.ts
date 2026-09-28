import { describe, expect, it } from 'vitest';
import {
	formatDate,
	formatDayNote,
	formatFetchedAt,
	formatMonthDay,
	formatWeekday,
	STATUS_LABELS,
} from './timetable-label.ts';

describe('formatDate', () => {
	it('月と日と曜日で出す', () => {
		expect(formatDate('2026-10-05')).toBe('10/5 (月)');
		expect(formatDate('2027-01-10')).toBe('1/10 (日)');
	});
});

describe('formatMonthDay と formatWeekday', () => {
	it('月日と、括弧付きの曜日を、別々に返す (狭い画面で、曜日を必ず 2 行目に置くため)', () => {
		expect(formatMonthDay('2026-10-05')).toBe('10/5');
		expect(formatWeekday('2026-10-05')).toBe('(月)');
		expect(`${formatMonthDay('2027-01-10')} ${formatWeekday('2027-01-10')}`).toBe(
			formatDate('2027-01-10'),
		);
	});
});

describe('formatDayNote', () => {
	it('振替授業日は、行う曜日を出す', () => {
		expect(formatDayNote({ kind: 'substitute', weekday: 1 })).toBe('月曜の授業を行う日');
	});

	it('全学の休講日は、行事名があれば添える', () => {
		expect(formatDayNote({ kind: 'noClass', label: '大学祭' })).toBe('全学の休講日 (大学祭)');
		expect(formatDayNote({ kind: 'noClass', label: null })).toBe('全学の休講日');
	});

	it('祝日は、その名前を出す', () => {
		expect(formatDayNote({ kind: 'holiday', name: 'スポーツの日' })).toBe('スポーツの日');
	});
});

describe('formatFetchedAt', () => {
	it('今日と昨日は、その言葉で出す', () => {
		expect(formatFetchedAt({ date: '2026-10-05', time: '12:00' }, '2026-10-05')).toBe('今日 12:00');
		expect(formatFetchedAt({ date: '2026-10-04', time: '23:10' }, '2026-10-05')).toBe('昨日 23:10');
	});

	it('それより前は、日付で出す', () => {
		expect(formatFetchedAt({ date: '2026-10-01', time: '08:05' }, '2026-10-05')).toBe(
			'10/1 (木) 08:05',
		);
	});
});

describe('STATUS_LABELS', () => {
	it('色だけで伝えないよう、ふだんの授業以外に文字のラベルがある', () => {
		expect(STATUS_LABELS).toEqual({ cancelled: '休講', makeup: '補講', roomChanged: '教室変更' });
	});
});
