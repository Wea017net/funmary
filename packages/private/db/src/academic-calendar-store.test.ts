import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAcademicCalendarStore } from './academic-calendar-store.ts';
import { openDatabase, type Database } from './database.ts';

let dir: string;
let database: Database;
const now = new Date('2026-09-26T00:00:00Z');

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-calendar-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

describe('学期の期間', () => {
	it('年度ごとに保存し、読み戻せる', () => {
		const store = createAcademicCalendarStore(database);
		store.saveTerm(2026, { term: 'spring', start: '2026-04-06', end: '2026-07-24' }, 'manual', now);
		store.saveTerm(2027, { term: 'spring', start: '2027-04-05', end: '2027-07-23' }, 'manual', now);
		expect(store.listTerms(2026)).toEqual([
			{ term: 'spring', start: '2026-04-06', end: '2026-07-24', source: 'manual' },
		]);
		expect(store.listTerms(2027)).toHaveLength(1);
		expect(store.listTerms(2030)).toEqual([]);
	});

	it('同じ学期に保存し直すと上書きする', () => {
		const store = createAcademicCalendarStore(database);
		store.saveTerm(2026, { term: 'fall', start: '2026-09-28', end: '2027-01-21' }, 'manual', now);
		store.saveTerm(2026, { term: 'fall', start: '2026-09-24', end: '2027-01-21' }, 'manual', now);
		expect(store.listTerms(2026)).toEqual([
			{ term: 'fall', start: '2026-09-24', end: '2027-01-21', source: 'manual' },
		]);
	});

	it('自動で取った値は、管理者が入れた値を上書きしない。手入力は自動の値を上書きする', () => {
		const store = createAcademicCalendarStore(database);
		const auto = { term: 'spring', start: '2026-04-06', end: '2026-07-24' } as const;
		const manual = { term: 'spring', start: '2026-04-07', end: '2026-07-23' } as const;
		store.saveTerm(2026, manual, 'manual', now);
		expect(store.saveTerm(2026, auto, 'auto', now)).toBe(false);
		expect(store.listTerms(2026)[0]).toMatchObject({ start: '2026-04-07', source: 'manual' });

		store.deleteTerm(2026, 'spring');
		store.saveTerm(2026, auto, 'auto', now);
		expect(store.saveTerm(2026, manual, 'manual', now)).toBe(true);
		expect(store.listTerms(2026)[0]).toMatchObject({ start: '2026-04-07', source: 'manual' });
	});
});

describe('振替授業日', () => {
	it('日付と、その日に行う曜日を保存し、期間で絞って読み戻せる', () => {
		const store = createAcademicCalendarStore(database);
		store.saveSubstituteDay({ date: '2026-04-30', weekday: 3 }, 'manual');
		store.saveSubstituteDay({ date: '2026-10-16', weekday: 1 }, 'manual');
		expect(store.listSubstituteDays('2026-04-01', '2026-07-31')).toEqual([
			{ date: '2026-04-30', weekday: 3 },
		]);
		expect(store.listSubstituteDays('2026-01-01', '2026-12-31')).toHaveLength(2);
	});

	it('同じ日付を保存し直すと、曜日を上書きする。削除もできる', () => {
		const store = createAcademicCalendarStore(database);
		store.saveSubstituteDay({ date: '2026-04-30', weekday: 3 }, 'manual');
		store.saveSubstituteDay({ date: '2026-04-30', weekday: 2 }, 'manual');
		expect(store.listSubstituteDays('2026-04-01', '2026-04-30')).toEqual([
			{ date: '2026-04-30', weekday: 2 },
		]);
		store.deleteSubstituteDay('2026-04-30');
		expect(store.listSubstituteDays('2026-04-01', '2026-04-30')).toEqual([]);
	});
});

describe('全学の休講日', () => {
	it('日付を保存し、期間で絞って読み戻せる。削除もできる', () => {
		const store = createAcademicCalendarStore(database);
		store.saveNoClassDay('2026-10-24', '大学祭', 'manual');
		store.saveNoClassDay('2026-12-28', null, 'manual');
		expect(store.listNoClassDays('2026-10-01', '2026-10-31')).toEqual([
			{ date: '2026-10-24', label: '大学祭' },
		]);
		store.deleteNoClassDay('2026-10-24');
		expect(store.listNoClassDays('2026-10-01', '2026-12-31')).toEqual([
			{ date: '2026-12-28', label: null },
		]);
	});
});

describe('自動で取った日の入れ替え', () => {
	const range = { start: '2026-04-01', end: '2027-03-31' } as const;

	it('範囲の中の自動の振替授業日と休講日を、新しい一覧で入れ替える', () => {
		const store = createAcademicCalendarStore(database);
		store.replaceAutoDays(range, {
			substituteDays: [{ date: '2026-04-30', weekday: 3 }],
			noClassDays: [{ date: '2027-01-15', label: '休講' }],
		});
		store.replaceAutoDays(range, {
			substituteDays: [{ date: '2026-07-24', weekday: 1 }],
			noClassDays: [{ date: '2026-12-28', label: null }],
		});
		expect(store.listSubstituteDays(range.start, range.end)).toEqual([
			{ date: '2026-07-24', weekday: 1 },
		]);
		expect(store.listNoClassDays(range.start, range.end)).toEqual([
			{ date: '2026-12-28', label: null },
		]);
	});

	it('管理者が入れた日は、消さず、自動の値で上書きもしない', () => {
		const store = createAcademicCalendarStore(database);
		store.saveSubstituteDay({ date: '2026-04-30', weekday: 4 }, 'manual');
		store.saveNoClassDay('2027-01-15', '全学休講', 'manual');
		const skipped = store.replaceAutoDays(range, {
			substituteDays: [{ date: '2026-04-30', weekday: 3 }],
			noClassDays: [
				{ date: '2027-01-15', label: '休講' },
				{ date: '2027-01-11', label: null },
			],
		});
		expect(skipped).toEqual({ substituteDays: ['2026-04-30'], noClassDays: ['2027-01-15'] });
		expect(store.listSubstituteDays(range.start, range.end)).toEqual([
			{ date: '2026-04-30', weekday: 4 },
		]);
		expect(store.listNoClassDays(range.start, range.end)).toEqual([
			{ date: '2027-01-11', label: null },
			{ date: '2027-01-15', label: '全学休講' },
		]);
	});

	it('範囲の外の自動の日は消さない', () => {
		const store = createAcademicCalendarStore(database);
		store.saveSubstituteDay({ date: '2027-04-30', weekday: 3 }, 'auto');
		store.replaceAutoDays(range, { substituteDays: [], noClassDays: [] });
		expect(store.listSubstituteDays('2027-04-01', '2028-03-31')).toEqual([
			{ date: '2027-04-30', weekday: 3 },
		]);
	});
});
