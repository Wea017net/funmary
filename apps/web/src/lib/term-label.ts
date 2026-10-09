import { WEEKDAY_NAMES, type Term } from '@funmary/core';

const TERM_LABELS = new Map<string, string>([
	['full-year', '通年'],
	['spring', '前期'],
	['fall', '後期'],
	['q1', '1Q'],
	['q2', '2Q'],
	['q3', '3Q'],
	['q4', '4Q'],
	['summer-intensive', '夏期集中'],
	['winter-intensive', '冬期集中'],
] satisfies [Term, string][]);

/** 学期の画面の表記。DB の値が知らないものなら、そのまま出す */
export function formatTerm(term: string): string {
	return TERM_LABELS.get(term) ?? term;
}

/** 時間割の枠に選べる曜日。未来大の授業は月曜から土曜まで */
export const WEEKDAY_LABELS = [
	{ weekday: 1, label: '月' },
	{ weekday: 2, label: '火' },
	{ weekday: 3, label: '水' },
	{ weekday: 4, label: '木' },
	{ weekday: 5, label: '金' },
	{ weekday: 6, label: '土' },
] as const;

/** 曜日と時限の表記。例: "月曜 2 限" */
export function formatSlot(slot: { readonly weekday: number; readonly period: number }): string {
	return `${WEEKDAY_NAMES[slot.weekday] ?? '?'}曜 ${slot.period} 限`;
}
