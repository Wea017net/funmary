import { addDays, type CalendarDate } from '@funmary/core';

/** URL の日付 ("YYYY-MM-DD") を読む。暦にない日付や形の違うものは null */
export function parseDateParam(value: string | null): CalendarDate | null {
	if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	// 2026-02-30 のような日付は、計算すると別の日にずれるので、ずれたものを弾く
	return addDays(value, 0) === value ? value : null;
}
