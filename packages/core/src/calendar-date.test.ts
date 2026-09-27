import { describe, expect, it } from 'vitest';
import { academicYearOf, jstDateTime, startOfWeek } from './calendar-date.ts';

describe('jstDateTime', () => {
	it('UTC の時刻を、日本時間の日付と時刻にする', () => {
		expect(jstDateTime(new Date('2026-10-05T14:59:00Z'))).toEqual({
			date: '2026-10-05',
			time: '23:59',
		});
		expect(jstDateTime(new Date('2026-10-05T15:00:00Z'))).toEqual({
			date: '2026-10-06',
			time: '00:00',
		});
	});

	it('年の境目も日本時間で決める', () => {
		expect(jstDateTime(new Date('2026-12-31T15:30:00Z'))).toEqual({
			date: '2027-01-01',
			time: '00:30',
		});
	});
});

describe('academicYearOf', () => {
	it('4 月から翌年の 3 月までを 1 つの年度とする', () => {
		expect(academicYearOf('2026-04-01')).toBe(2026);
		expect(academicYearOf('2027-03-31')).toBe(2026);
		expect(academicYearOf('2027-01-10')).toBe(2026);
		expect(academicYearOf('2026-03-31')).toBe(2025);
	});
});

describe('startOfWeek', () => {
	it('日曜から土曜を 1 週とし、その週の日曜を返す', () => {
		expect(startOfWeek('2026-10-04')).toBe('2026-10-04');
		expect(startOfWeek('2026-10-05')).toBe('2026-10-04');
		expect(startOfWeek('2026-10-10')).toBe('2026-10-04');
		expect(startOfWeek('2026-10-11')).toBe('2026-10-11');
	});

	it('月や年をまたぐ週も扱う', () => {
		expect(startOfWeek('2027-01-01')).toBe('2026-12-27');
	});
});
