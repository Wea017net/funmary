import { WebSocketShardEvents } from '@discordjs/ws';
import { createLogger } from '@funmary/log';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDiscordPresence, type PresenceManager } from './discord-presence.ts';

const TOKEN = 'dummy-bot-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

const lines: string[] = [];
const log = createLogger({
	level: 'debug',
	format: 'text',
	mode: 'production',
	write: (line) => lines.push(line),
});

/** つなぐ、閉じる、イベントの登録を記録する、偽の WebSocketManager */
function fakeManager(connect: () => Promise<void> = () => Promise.resolve()) {
	const state = {
		connects: 0,
		destroyed: [] as unknown[],
		handlers: new Map<string, (...args: never[]) => void>(),
	};
	const manager = {
		connect: () => {
			state.connects++;
			return connect();
		},
		destroy: (options?: unknown) => {
			state.destroyed.push(options);
			return Promise.resolve();
		},
		on: (event: string, handler: (...args: never[]) => void) => {
			state.handlers.set(event, handler);
			return manager;
		},
	} as unknown as PresenceManager;
	return { manager, state };
}

beforeEach(() => {
	lines.length = 0;
});

describe('createDiscordPresence', () => {
	it('start でつなぎ、2 回呼んでも、つなぐのは 1 回', () => {
		const { manager, state } = fakeManager();
		const presence = createDiscordPresence({ token: TOKEN, log, createManager: () => manager });
		presence.start();
		presence.start();
		expect(state.connects).toBe(1);
	});

	it('stop で、閉じる。そのあと start すれば、もう一度つなぐ', () => {
		const first = fakeManager();
		const second = fakeManager();
		const managers = [first.manager, second.manager];
		const presence = createDiscordPresence({
			token: TOKEN,
			log,
			createManager: () => managers.shift() as PresenceManager,
		});
		presence.start();
		presence.stop();
		expect(first.state.destroyed).toEqual([{ code: 1000 }]);
		presence.start();
		expect(second.state.connects).toBe(1);
	});

	it('つながったこと、切れたことを、ログに残す', () => {
		const { manager, state } = fakeManager();
		createDiscordPresence({ token: TOKEN, log, createManager: () => manager }).start();
		(state.handlers.get(WebSocketShardEvents.Ready) as () => void)();
		(state.handlers.get(WebSocketShardEvents.Closed) as (code: number) => void)(1006);
		const text = lines.join('\n');
		expect(text).toContain('オンライン表示');
		expect(text).toContain('1006');
	});

	it('つなげなかったときは、例外にせず、ログに残す。トークンは出さない。あとで、つなぎ直せる', async () => {
		const failing = fakeManager(() => Promise.reject(new Error('Invalid token')));
		const ok = fakeManager();
		const managers = [failing.manager, ok.manager];
		const presence = createDiscordPresence({
			token: TOKEN,
			log,
			createManager: () => managers.shift() as PresenceManager,
		});
		presence.start();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(lines.join('\n')).toContain('Gateway につなげませんでした: Invalid token');
		expect(lines.join('\n')).not.toContain(TOKEN);
		presence.start();
		expect(ok.state.connects).toBe(1);
	});
});
