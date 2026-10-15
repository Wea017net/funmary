import { addDays, isoWeekday, type CalendarDate } from '@funmary/core';
import { describe, expect, it } from 'vitest';
import type { PdfTextItem } from '../timetable-pdf/grid.ts';
import { parseAcademicCalendarPages, type PdfFillRect, type PdfPageContent } from './calendar.ts';

const DARK = '#bfbfbf';
const LIGHT = 'pattern:dots';
const GREEN = '#c6e0b4';

type CellFill = typeof DARK | typeof LIGHT | typeof GREEN;

interface CellSpec {
	readonly fill?: CellFill;
	readonly labels?: readonly string[];
	readonly count?: number;
}

interface PageOptions {
	readonly academicYear: number;
	readonly cells: ReadonlyMap<CalendarDate, CellSpec>;
	/** 表題 (省くと日本語の表題) */
	readonly title?: string;
	/** 凡例の塗り (省くと DARK と LIGHT) */
	readonly legend?: { readonly odd: string; readonly even: string } | null;
	/** 日付の数字を書き換える (読み違いの確かめ) */
	readonly dateText?: (date: CalendarDate) => string;
	/** 同じ週の同じ色の平日を、実物のように 1 つの横長の矩形で塗る */
	readonly mergeRows?: boolean;
}

const COLUMN_LEFT = 47;
const COLUMN_WIDTH = 70;
const FIRST_ROW_Y = 776;
const ROW_HEIGHT = 14;

function text(value: string, x: number, y: number): PdfTextItem {
	return { text: value, x, y, height: 5.6, width: value.length * 5 };
}

/** 実物の学年暦と同じ配置で、1 ページ分の文字と塗りを組み立てる */
function buildPage(options: PageOptions): PdfPageContent {
	const { academicYear, cells } = options;
	const texts: PdfTextItem[] = [
		text(options.title ?? `令和${academicYear - 2018}年(${academicYear}年)度 学年暦`, 236, 826),
		text('通常授業日：', 33, 806),
	];
	const fills: PdfFillRect[] = [];
	const legend = options.legend === undefined ? { odd: DARK, even: LIGHT } : options.legend;
	if (legend) {
		texts.push(text('1Q,3Q', 65, 806), text('2Q, 4Q', 87.5, 806));
		fills.push(
			{ fill: legend.odd, x0: 60, y0: 803, x1: 84, y1: 811.6 },
			{ fill: legend.even, x0: 84, y0: 803, x1: 107.6, y1: 811.6 },
		);
	}
	['日', '月', '火', '水', '木', '金', '土'].forEach((name, i) =>
		texts.push(text(name, COLUMN_LEFT + i * COLUMN_WIDTH + 30, 794)),
	);

	const aprilFirst = `${academicYear}-04-01`;
	const firstSunday = addDays(aprilFirst, -(isoWeekday(aprilFirst) % 7));
	const lastDate = `${academicYear + 1}-03-31`;
	for (let row = 0; addDays(firstSunday, row * 7) <= lastDate; row++) {
		const y = FIRST_ROW_Y - row * ROW_HEIGHT;
		const rowFills: PdfFillRect[] = [];
		for (let column = 0; column < 7; column++) {
			const date = addDays(firstSunday, row * 7 + column);
			if (date > lastDate) break;
			const left = COLUMN_LEFT + column * COLUMN_WIDTH;
			texts.push(text(options.dateText?.(date) ?? String(Number(date.slice(8))), left + 3.5, y));
			const spec = cells.get(date);
			if (!spec) continue;
			if (spec.count !== undefined) texts.push(text(String(spec.count), left + 44, y + 2));
			spec.labels?.forEach((label, i) => texts.push(text(label, left + 12, y + 4 - i * 6)));
			if (spec.fill) {
				const rect = {
					fill: spec.fill,
					x0: left,
					y0: y - 4.2,
					x1: left + COLUMN_WIDTH,
					y1: y + 9.9,
				};
				const previous = rowFills.at(-1);
				if (options.mergeRows && previous?.fill === spec.fill && previous.x1 === left) {
					rowFills[rowFills.length - 1] = { ...previous, x1: rect.x1 };
				} else {
					rowFills.push(rect);
				}
			}
		}
		fills.push(...rowFills);
		// 罫線 (細い黒の矩形)。色の判定に混ざらないことを確かめる
		fills.push({
			fill: '#000000',
			x0: COLUMN_LEFT,
			y0: y - 4.3,
			x1: COLUMN_LEFT + 7 * COLUMN_WIDTH,
			y1: y - 4,
		});
	}
	return { texts, fills };
}

/** start から end まで (両端を含む) の平日に、同じセルの指定を入れる */
function weekdays(
	cells: Map<CalendarDate, CellSpec>,
	start: CalendarDate,
	end: CalendarDate,
	spec: CellSpec,
): void {
	for (let date = start; date <= end; date = addDays(date, 1)) {
		if (isoWeekday(date) <= 5) cells.set(date, { ...cells.get(date), ...spec });
	}
}

/** 2030 年度の、架空の学年暦 */
function sampleCells(): Map<CalendarDate, CellSpec> {
	const cells = new Map<CalendarDate, CellSpec>();
	weekdays(cells, '2030-04-08', '2030-06-06', { fill: DARK });
	weekdays(cells, '2030-06-07', '2030-07-26', { fill: LIGHT });
	weekdays(cells, '2030-07-29', '2030-08-02', { fill: LIGHT, labels: ['定期試験'] });
	cells.set('2030-08-05', { fill: LIGHT, labels: ['定期試験予備日'] });
	// 前期の中の休み
	cells.set('2030-04-29', { labels: ['昭和の日'] });
	cells.set('2030-05-06', { labels: ['振替休日'] });
	cells.set('2030-06-14', { labels: ['休講'] });
	// 月曜の授業を水曜に行う
	cells.set('2030-05-01', { fill: DARK, labels: ['（月曜振替授業）'] });
	weekdays(cells, '2030-08-19', '2030-08-23', { fill: GREEN, labels: ['集中講義'] });

	weekdays(cells, '2030-09-24', '2030-11-15', { fill: DARK });
	weekdays(cells, '2030-11-18', '2031-01-24', { fill: LIGHT });
	for (const date of [
		'2030-12-26',
		'2030-12-27',
		'2030-12-30',
		'2030-12-31',
		'2031-01-02',
		'2031-01-03',
	]) {
		cells.set(date, { labels: ['年末年始休日'] });
	}
	cells.set('2031-01-01', { labels: ['元日'] });
	weekdays(cells, '2031-01-27', '2031-01-31', { fill: LIGHT, labels: ['定期試験'] });
	weekdays(cells, '2031-02-03', '2031-02-06', { fill: GREEN, labels: ['集中講義'] });
	return cells;
}

function parseSample(options: Partial<PageOptions> = {}) {
	return parseAcademicCalendarPages([
		buildPage({ academicYear: 2030, cells: sampleCells(), ...options }),
	]);
}

describe('学年暦の PDF の読み取り', () => {
	it('セルの色から、学期とクォーターと集中講義の期間を読む。定期試験の日は授業期間に含めない', () => {
		const result = parseSample();
		if (result.kind !== 'ok') throw new Error(`読めるはず: ${result.reason}`);
		expect(result.academicYear).toBe(2030);
		expect(result.terms).toEqual([
			{ term: 'spring', start: '2030-04-08', end: '2030-07-26' },
			{ term: 'q1', start: '2030-04-08', end: '2030-06-06' },
			{ term: 'q2', start: '2030-06-07', end: '2030-07-26' },
			{ term: 'summer-intensive', start: '2030-08-19', end: '2030-08-23' },
			{ term: 'fall', start: '2030-09-24', end: '2031-01-24' },
			{ term: 'q3', start: '2030-09-24', end: '2030-11-15' },
			{ term: 'q4', start: '2030-11-18', end: '2031-01-24' },
			{ term: 'winter-intensive', start: '2031-02-03', end: '2031-02-06' },
		]);
		expect(result.warnings).toEqual([]);
	});

	it('「(X曜振替授業)」の日を、振替授業日として読む', () => {
		const result = parseSample();
		if (result.kind !== 'ok') throw new Error(`読めるはず: ${result.reason}`);
		expect(result.substituteDays).toEqual([{ date: '2030-05-01', weekday: 1 }]);
	});

	it('授業期間の中の塗りのない平日を、全学の休講日の候補として、行事名と一緒に返す', () => {
		const result = parseSample();
		if (result.kind !== 'ok') throw new Error(`読めるはず: ${result.reason}`);
		expect(result.noClassDays).toEqual([
			{ date: '2030-04-29', label: '昭和の日' },
			{ date: '2030-05-06', label: '振替休日' },
			{ date: '2030-06-14', label: '休講' },
			{ date: '2030-12-26', label: '年末年始休日' },
			{ date: '2030-12-27', label: '年末年始休日' },
			{ date: '2030-12-30', label: '年末年始休日' },
			{ date: '2030-12-31', label: '年末年始休日' },
			{ date: '2031-01-01', label: '元日' },
			{ date: '2031-01-02', label: '年末年始休日' },
			{ date: '2031-01-03', label: '年末年始休日' },
		]);
	});

	it('実物のように、同じ週の平日をまとめて塗った矩形でも読める', () => {
		const merged = parseSample({ mergeRows: true });
		const separate = parseSample();
		expect(merged).toEqual(separate);
	});

	it('色の値は決め打ちせず、凡例の色で判定する', () => {
		const cells = new Map(
			[...sampleCells()].map(([date, spec]): [CalendarDate, CellSpec] => [
				date,
				{
					...spec,
					...(spec.fill === DARK && { fill: LIGHT }),
					...(spec.fill === LIGHT && { fill: DARK }),
				},
			]),
		);
		const swapped = parseAcademicCalendarPages([
			buildPage({ academicYear: 2030, cells, legend: { odd: LIGHT, even: DARK } }),
		]);
		expect(swapped).toEqual(parseSample());
	});

	it('日付の数字が暦と 1 つでも合わなければ、読み違えとして invalid にする', () => {
		const result = parseSample({
			dateText: (date) => (date === '2030-10-10' ? '11' : String(Number(date.slice(8)))),
		});
		expect(result).toEqual({
			kind: 'invalid',
			reason: '2030-10-10 のセルの日付が 11 になっていて、暦と合いません',
		});
	});

	it('凡例がなければ、色の意味が分からないので invalid にする', () => {
		expect(parseSample({ legend: null })).toMatchObject({ kind: 'invalid' });
	});

	it('表題から年度を読めなければ invalid にする', () => {
		expect(parseSample({ title: '学年暦' })).toMatchObject({ kind: 'invalid' });
	});

	it('セルに書かれた授業の回数が、数えた回数と合えば警告を出さない。振替授業日は振り替えた曜日で数える', () => {
		const cells = sampleCells();
		// 月曜: 4/8、4/15、4/22、(4/29 は休み)、5/1 (水曜に振替)、5/13
		cells.set('2030-04-22', { fill: DARK, count: 3 });
		cells.set('2030-05-13', { fill: DARK, count: 5 });
		// 水曜: 4/10、4/17、4/24、(5/1 は月曜の授業)、5/8
		cells.set('2030-05-08', { fill: DARK, count: 4 });
		const result = parseAcademicCalendarPages([buildPage({ academicYear: 2030, cells })]);
		if (result.kind !== 'ok') throw new Error(`読めるはず: ${result.reason}`);
		expect(result.warnings).toEqual([]);
	});

	it('セルに書かれた授業の回数が、数えた回数と食い違えば警告にする', () => {
		const cells = sampleCells();
		cells.set('2030-05-13', { fill: DARK, count: 4 });
		const result = parseAcademicCalendarPages([buildPage({ academicYear: 2030, cells })]);
		if (result.kind !== 'ok') throw new Error(`読めるはず: ${result.reason}`);
		expect(result.warnings).toEqual([
			'2030-05-13 (月曜の授業) の回数は、数えると 5 回目ですが、PDF には 4 と書かれています',
		]);
	});

	it('日本語のページのほかに英語のページがあれば、色を照らし合わせ、違う日があれば警告にする', () => {
		const japanese = buildPage({ academicYear: 2030, cells: sampleCells() });
		const same = buildPage({
			academicYear: 2030,
			cells: sampleCells(),
			title: 'Academic Calendar 2030-2031',
		});
		expect(parseAcademicCalendarPages([japanese, same])).toEqual(parseSample());

		const cells = sampleCells();
		cells.set('2030-06-07', { fill: DARK });
		const different = buildPage({
			academicYear: 2030,
			cells,
			title: 'Academic Calendar 2030-2031',
		});
		const result = parseAcademicCalendarPages([japanese, different]);
		if (result.kind !== 'ok') throw new Error(`読めるはず: ${result.reason}`);
		expect(result.warnings).toEqual([
			'日本語のページと英語のページで、セルの色が違う日があります: 2030-06-07',
		]);
	});

	it('日本語の表題のページがなければ invalid にする', () => {
		const english = buildPage({
			academicYear: 2030,
			cells: sampleCells(),
			title: 'Academic Calendar 2030-2031',
		});
		expect(parseAcademicCalendarPages([english])).toMatchObject({ kind: 'invalid' });
	});
});
