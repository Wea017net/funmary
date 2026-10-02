import { createLogger } from '@funmary/log';
import { describe, expect, it } from 'vitest';
import {
	createDeliverNotificationsJob,
	type DeliverNotificationsDeps,
	type DeliveryItem,
	type DeliveryOutcome,
} from './deliver-notifications.ts';

const log = createLogger({ level: 'error', format: 'text', mode: 'production' });
const NOW = new Date('2026-10-01T00:00:00Z');
const context = { signal: new AbortController().signal, now: () => NOW, log };

const item = (overrides: Partial<DeliveryItem> = {}): DeliveryItem => ({
	id: 1,
	attempts: 0,
	channelId: 10,
	userId: 'u1',
	channelKind: 'discord',
	hasTarget: true,
	...overrides,
});

function setup(items: DeliveryItem[], outcomes: DeliveryOutcome[], streak = 0) {
	const calls: string[] = [];
	const notices: { userId: string; title: string; link: string | null; dedupeKey: string }[] = [];
	const queue = [...items];
	const deps: DeliverNotificationsDeps = {
		prepare: () => {
			calls.push('prepare');
			return 0;
		},
		claim: () => queue.splice(0, queue.length),
		send: () => Promise.resolve(outcomes.shift()!),
		markSent: (id) => calls.push(`sent:${id}`),
		markRetry: (id, plan) =>
			calls.push(`retry:${id}:${plan.attempts}:${plan.nextAttemptAt.getTime() - NOW.getTime()}`),
		markFailed: (id, error) => calls.push(`failed:${id}:${error}`),
		failureStreak: () => streak,
		disableChannel: (channelId, reason) => calls.push(`disable:${channelId}:${reason}`),
		notifyUser: (notice) => notices.push(notice),
	};
	return { job: createDeliverNotificationsJob(deps), calls, notices };
}

describe('通知を送る定期処理', () => {
	it('送れたら済みにして、送った数を返す。何もなければ何も返さない', async () => {
		const sent = setup(
			[item({ id: 1 }), item({ id: 2 })],
			[{ status: 'sent' }, { status: 'sent' }],
		);
		await expect(sent.job.run(context)).resolves.toBe('通知を 2 件送りました');
		expect(sent.calls).toEqual(['prepare', 'sent:1', 'sent:2']);
		const idle = setup([], []);
		await expect(idle.job.run(context)).resolves.toBeUndefined();
		expect(idle.job.quietWhenIdle).toBe(true);
	});

	it('再送する結果は、間隔を広げて待たせる。429 は指定された時間を待つ', async () => {
		const { job, calls } = setup(
			[item({ id: 1, attempts: 0 }), item({ id: 2, attempts: 1 }), item({ id: 3, attempts: 0 })],
			[
				{ status: 'retry', afterMs: null, reason: 'HTTP 500' },
				{ status: 'retry', afterMs: null, reason: 'HTTP 500' },
				{ status: 'retry', afterMs: 7000, reason: 'HTTP 429' },
			],
		);
		await job.run(context);
		expect(calls).toEqual([
			'prepare',
			`retry:1:1:${60 * 1000}`,
			`retry:2:2:${5 * 60 * 1000}`,
			'retry:3:1:7000',
		]);
	});

	it('5 回目の失敗で、再送をやめる', async () => {
		const { job, calls } = setup(
			[item({ attempts: 4 })],
			[{ status: 'retry', afterMs: null, reason: 'HTTP 500' }],
		);
		await job.run(context);
		expect(calls).toEqual(['prepare', 'failed:1:HTTP 500']);
	});

	it('Webhook が消えていたら、チャネルを止めて、通知欄で知らせる', async () => {
		const { job, calls, notices } = setup(
			[item()],
			[{ status: 'gone', reason: 'Webhook が見つかりません (HTTP 404)' }],
		);
		await job.run(context);
		expect(calls).toEqual([
			'prepare',
			'failed:1:Webhook が見つかりません (HTTP 404)',
			'disable:10:Webhook が見つかりません (HTTP 404)',
		]);
		expect(notices).toHaveLength(1);
		expect(notices[0]).toMatchObject({ userId: 'u1', link: '/app/settings/webhooks' });
		expect(notices[0]!.title).toContain('連携の不具合');
	});

	it('Discord 連携の送り先が消えていたら、連携し直すよう知らせる', async () => {
		const { job, notices } = setup(
			[item({ channelKind: 'discordLink' })],
			[{ status: 'gone', reason: '送り先に送れません (HTTP 403)' }],
		);
		await job.run(context);
		expect(notices[0]).toMatchObject({ link: '/app/settings/discord' });
	});

	it('送り先が引けない配信 (連携の解除) は、送らずに失敗にする', async () => {
		const { job, calls } = setup([item({ hasTarget: false })], []);
		await job.run(context);
		expect(calls).toEqual(['prepare', 'failed:1:送り先がありません']);
	});

	it('再送しても直らない失敗が続いたら、チャネルを止める', async () => {
		const failing = setup([item()], [{ status: 'rejected', reason: 'HTTP 400' }], 3);
		await failing.job.run(context);
		expect(failing.calls).toEqual([
			'prepare',
			'failed:1:HTTP 400',
			'disable:10:続けて失敗しました',
		]);
		expect(failing.notices).toHaveLength(1);
		const once = setup([item()], [{ status: 'rejected', reason: 'HTTP 400' }], 1);
		await once.job.run(context);
		expect(once.calls).toEqual(['prepare', 'failed:1:HTTP 400']);
		expect(once.notices).toHaveLength(0);
	});

	it('1 件の送信が例外を投げても、ほかの配信を続ける', async () => {
		const calls: string[] = [];
		const queue = [item({ id: 1 }), item({ id: 2 })];
		let first = true;
		const job = createDeliverNotificationsJob({
			prepare: () => 0,
			claim: () => queue.splice(0, queue.length),
			send: () => {
				if (first) {
					first = false;
					return Promise.reject(new Error('boom'));
				}
				return Promise.resolve({ status: 'sent' });
			},
			markSent: (id) => calls.push(`sent:${id}`),
			markRetry: (id) => calls.push(`retry:${id}`),
			markFailed: () => {},
			failureStreak: () => 0,
			disableChannel: () => {},
			notifyUser: () => {},
		});
		await job.run(context);
		expect(calls).toEqual(['retry:1', 'sent:2']);
	});
});
