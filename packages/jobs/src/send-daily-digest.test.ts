import { DEFAULT_DAILY_DIGEST_SETTINGS, type DailyDigestSettings } from '@funmary/core';
import { createLogger } from '@funmary/log';
import { describe, expect, it } from 'vitest';
import type { JobContext } from './runner.ts';
import {
	createSendDailyDigestJob,
	type DailyDigestTarget,
	type SendDailyDigestDeps,
} from './send-daily-digest.ts';

const target = (
	userId: string,
	settings: Partial<DailyDigestSettings> = {},
	lastSentFor: string | null = null,
): DailyDigestTarget => ({
	userId,
	channelId: `channel-${userId}`,
	settings: { ...DEFAULT_DAILY_DIGEST_SETTINGS, ...settings },
	lastSentFor,
});

function setup(
	targets: DailyDigestTarget[],
	overrides: Partial<SendDailyDigestDeps> = {},
	// 2026-10-01 20:30 (日本時間)
	now = '2026-10-01T11:30:00Z',
) {
	const sent: { channelId: string; text: string }[] = [];
	const marked: { userId: string; date: string }[] = [];
	const job = createSendDailyDigestJob({
		listTargets: () => targets,
		compose: (userId, date, timing) => ({ text: `${userId} ${date} ${timing}`, empty: false }),
		send: (channelId, text) => {
			sent.push({ channelId, text });
			return Promise.resolve('sent');
		},
		markSent: (userId, date) => marked.push({ userId, date }),
		...overrides,
	});
	const context: JobContext = {
		signal: new AbortController().signal,
		now: () => new Date(now),
		log: createLogger({ level: 'error', format: 'text', mode: 'development' }),
	};
	return { job, context, sent, marked };
}

describe('予定のまとめを送る定期処理', () => {
	it('5 分ごとに動き、何もしなかった回は記録しない', () => {
		const { job } = setup([]);
		expect(job.schedule).toBe('*/5 * * * *');
		expect(job.quietWhenIdle).toBe(true);
	});

	it('送る時刻になった人にだけ送り、送ったことを記録する', async () => {
		const t = setup([target('a'), target('b', { timing: 'morning' })]);
		expect(await t.job.run(t.context)).toBe('1 人に予定のまとめを送りました');
		expect(t.sent).toEqual([{ channelId: 'channel-a', text: 'a 2026-10-02 evening' }]);
		expect(t.marked).toEqual([{ userId: 'a', date: '2026-10-02' }]);
	});

	it('送る人がいなければ、何も返さない', async () => {
		const t = setup([target('a', {}, '2026-10-02'), target('b', { enabled: false })]);
		expect(await t.job.run(t.context)).toBeUndefined();
		expect(t.sent).toEqual([]);
	});

	it('予定のない日に送らない設定なら、送らずに、送ったものとして記録する', async () => {
		const t = setup([target('a', { sendWhenEmpty: false })], {
			compose: () => ({ text: '予定はありません', empty: true }),
		});
		expect(await t.job.run(t.context)).toBeUndefined();
		expect(t.sent).toEqual([]);
		expect(t.marked).toEqual([{ userId: 'a', date: '2026-10-02' }]);
	});

	it('送り先が消えていたら、その日は送ったものとして記録し、ほかの人には送り続ける', async () => {
		const t = setup([target('gone'), target('a')], {
			send: (channelId) => Promise.resolve(channelId === 'channel-gone' ? 'gone' : 'sent'),
		});
		expect(await t.job.run(t.context)).toBe(
			'1 人に予定のまとめを送りました。1 人は送り先がなくなっていました',
		);
		expect(t.marked.map((mark) => mark.userId)).toEqual(['gone', 'a']);
	});

	it('一時的な失敗は記録せず (次の回に送り直す)、ほかの人に送ってから失敗として返す', async () => {
		const t = setup([target('flaky'), target('a')], {
			send: (channelId) =>
				channelId === 'channel-flaky' ? Promise.reject(new Error('503')) : Promise.resolve('sent'),
		});
		await expect(t.job.run(t.context)).rejects.toThrow(
			'1 人に予定のまとめを送りました。1 人に送れませんでした (次の回に送り直します): 503',
		);
		expect(t.marked.map((mark) => mark.userId)).toEqual(['a']);
	});
});
