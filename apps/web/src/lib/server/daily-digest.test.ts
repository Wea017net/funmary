import { describe, expect, it } from 'vitest';
import { composeDailyDigest, type DailyDigestContent } from './daily-digest.ts';
import type { TimetableLesson } from './user-timetable.ts';

const lesson = (overrides: Partial<TimetableLesson>): TimetableLesson => ({
	date: '2026-10-02',
	period: 1,
	subjectId: 1,
	subjectName: '情報処理演習',
	academicYear: 2026,
	syllabusId: '1001',
	room: '363',
	roomIsTentative: false,
	status: 'normal',
	...overrides,
});

const content = (overrides: Partial<DailyDigestContent> = {}): DailyDigestContent => ({
	date: '2026-10-02',
	timing: 'evening',
	lessons: [],
	note: null,
	events: [],
	weekUrl: 'https://funmary.example.com/app/week?date=2026-10-02',
	...overrides,
});

describe('composeDailyDigest', () => {
	it('書き出しは、前日の夜、当日の朝、カスタムで変える', () => {
		const lessons = [lesson({})];
		expect(composeDailyDigest(content({ lessons }))?.split('\n')[0]).toBe(
			'今日も一日お疲れ様です。明日 10/2 (金) の予定です。',
		);
		expect(composeDailyDigest(content({ lessons, timing: 'morning' }))?.split('\n')[0]).toBe(
			'おはようございます。今日 10/2 (金) の予定です。',
		);
		expect(composeDailyDigest(content({ lessons, timing: 'custom' }))?.split('\n')[0]).toBe(
			'お疲れ様です。10/2 (金) の予定です。',
		);
	});

	it('授業を時限の順に、時刻、科目名、教室、休講などと並べ、予定を続ける', () => {
		const text = composeDailyDigest(
			content({
				lessons: [
					lesson({ period: 3, subjectName: '統計学', status: 'makeup', room: null }),
					lesson({ period: 1 }),
					lesson({ period: 2, subjectName: '線形代数', status: 'cancelled' }),
					lesson({
						period: 4,
						subjectName: '英語',
						status: 'roomChanged',
						room: '595',
					}),
					lesson({
						period: 5,
						subjectName: '物理',
						status: 'makeup',
						room: '483',
						roomIsTentative: true,
					}),
				],
				events: [
					{ time: '終日', title: '大学祭', location: null },
					{ time: '18:00-19:30', title: 'サークル', location: '体育館' },
				],
			}),
		);
		expect(text).toBe(
			[
				'今日も一日お疲れ様です。明日 10/2 (金) の予定です。',
				'',
				'**授業**',
				'1 限 09:00-10:30 情報処理演習 (363)',
				'2 限 10:40-12:10 ~~線形代数~~ [休講]',
				'3 限 13:10-14:40 統計学 (教室未定) [補講]',
				'4 限 14:50-16:20 英語 (595) [教室変更]',
				'5 限 16:30-18:00 物理 (483、仮。ふだんの教室) [補講]',
				'',
				'**予定**',
				'終日 大学祭',
				'18:00-19:30 サークル (体育館)',
				'',
				'<https://funmary.example.com/app/week?date=2026-10-02>',
			].join('\n'),
		);
	});

	it('祝日や振替授業日を、書き出しの次に出す', () => {
		const text = composeDailyDigest(
			content({
				lessons: [lesson({})],
				note: { kind: 'substitute', weekday: 1 },
			}),
		);
		expect(text?.split('\n').slice(0, 3)).toEqual([
			'今日も一日お疲れ様です。明日 10/2 (金) の予定です。',
			'月曜の授業を行う日',
			'',
		]);
	});

	it('授業も予定もなければ、予定がないと書く。祝日なら、その名前も出す', () => {
		expect(composeDailyDigest(content({ note: { kind: 'holiday', name: '文化の日' } }))).toBe(
			[
				'今日も一日お疲れ様です。明日 10/2 (金) に予定はありません。',
				'文化の日',
				'',
				'<https://funmary.example.com/app/week?date=2026-10-02>',
			].join('\n'),
		);
		expect(composeDailyDigest(content({ timing: 'custom' }))?.split('\n')[0]).toBe(
			'お疲れ様です。10/2 (金) に予定はありません。',
		);
	});

	it('科目名や予定の名前の、Discord の書式に効く記号は、ただの文字にする', () => {
		const text = composeDailyDigest(
			content({ events: [{ time: '終日', title: '**締切** _a_ `b` ~c~ > d', location: null }] }),
		);
		expect(text).toContain('終日 \\*\\*締切\\*\\* \\_a\\_ \\`b\\` \\~c\\~ \\> d');
	});
});
