// 予定のまとめ (#207) を、Discord と連携した利用者に送る定期処理。
// 5 分ごとに動き、利用者が選んだ時刻になった人にだけ送る。送る時刻を逃しても、少しの間なら遅れて送る (@funmary/core の dueDailyDigest)。
import {
	dueDailyDigest,
	jstDateTime,
	type CalendarDate,
	type DailyDigestSettings,
	type DailyDigestTiming,
} from '@funmary/core';
import type { JobDefinition } from './runner.ts';

export interface DailyDigestTarget {
	readonly userId: string;
	readonly channelId: string;
	readonly settings: DailyDigestSettings;
	readonly lastSentFor: CalendarDate | null;
}

export interface SendDailyDigestDeps {
	readonly listTargets: () => readonly DailyDigestTarget[];
	/** その日の授業と予定の文面。empty は、授業も予定もないとき true */
	readonly compose: (
		userId: string,
		date: CalendarDate,
		timing: DailyDigestTiming,
	) => { text: string; empty: boolean };
	/** gone は、送り先 (スレッドや DM) がなくなっていて、送り直しても届かないとき */
	readonly send: (channelId: string, text: string) => Promise<'sent' | 'gone'>;
	readonly markSent: (userId: string, date: CalendarDate, now: Date) => void;
}

export function createSendDailyDigestJob(deps: SendDailyDigestDeps): JobDefinition {
	return {
		name: 'send-daily-digest',
		schedule: '*/5 * * * *',
		timeoutMs: 4 * 60 * 1000,
		quietWhenIdle: true,
		async run({ now, log }) {
			const current = jstDateTime(now());
			let sent = 0;
			let gone = 0;
			const failures: string[] = [];
			for (const target of deps.listTargets()) {
				const due = dueDailyDigest(target.settings, current, target.lastSentFor);
				if (!due) continue;
				const { text, empty } = deps.compose(target.userId, due.date, target.settings.timing);
				if (empty && !target.settings.sendWhenEmpty) {
					deps.markSent(target.userId, due.date, now());
					continue;
				}
				try {
					const result = await deps.send(target.channelId, text);
					// なくなった送り先は、送り直しても届かないので、その日の分は済んだことにする
					deps.markSent(target.userId, due.date, now());
					if (result === 'sent') sent++;
					else gone++;
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					log.warn(`予定のまとめを送れませんでした: ${message}`);
					failures.push(message);
				}
			}
			if (sent === 0 && gone === 0 && failures.length === 0) return;
			const parts = [`${sent} 人に予定のまとめを送りました`];
			if (gone > 0) parts.push(`${gone} 人は送り先がなくなっていました`);
			if (failures.length > 0) {
				parts.push(
					`${failures.length} 人に送れませんでした (次の回に送り直します): ${[...new Set(failures)].join('、')}`,
				);
				throw new Error(parts.join('。'));
			}
			return parts.join('。');
		},
	};
}
