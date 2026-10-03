import { describe, expect, it, vi } from 'vitest';
import {
	commandPayloads,
	registerSlashCommands,
	SLASH_COMMANDS,
} from './discord-slash-commands.ts';

describe('commandPayloads', () => {
	it('サーバーとユーザーインストールの両方で、どこでも使えるように定義する', () => {
		for (const command of commandPayloads()) {
			expect(command.integration_types).toEqual([0, 1]);
			expect(command.contexts).toEqual([0, 1, 2]);
			expect(command.type).toBe(1);
		}
	});

	it('Issue #36 の例の 3 つを、名前だけで並べる', () => {
		expect(SLASH_COMMANDS.map((command) => command.name)).toEqual(['today', 'week', 'changes']);
	});
});

describe('registerSlashCommands', () => {
	it('グローバルコマンドを、Bot のトークンで PUT する', async () => {
		const fetch = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
		const count = await registerSlashCommands({
			token: 'secret-token',
			applicationId: '42',
			fetch,
		});

		expect(count).toBe(3);
		const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://discord.com/api/v10/applications/42/commands');
		expect(init.method).toBe('PUT');
		expect((init.headers as Record<string, string>)['Authorization']).toBe('Bot secret-token');
	});

	it('失敗したら状態だけを含む例外にし、トークンは含めない', async () => {
		const fetch = vi.fn().mockResolvedValue(new Response('no', { status: 401 }));
		const error = await registerSlashCommands({
			token: 'secret-token',
			applicationId: '42',
			fetch,
		}).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain('401');
		expect((error as Error).message).not.toContain('secret-token');
	});
});
