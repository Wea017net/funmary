import { describe, expect, it } from 'vitest';
import { buildLoginCommand, buildMcpConfig } from './token-setup.ts';

describe('buildMcpConfig', () => {
	it('手元の MCP (@funmary/mcp) の設定に、接続先とトークンを埋めた JSON を作る', () => {
		const config = JSON.parse(buildMcpConfig('https://funmary.example.com', 'fmy_secret')) as {
			mcpServers: {
				funmary: { command: string; args: string[]; env: Record<string, string> };
			};
		};
		expect(config.mcpServers.funmary).toEqual({
			command: 'npx',
			args: ['-y', '@funmary/mcp'],
			env: { FUNMARY_URL: 'https://funmary.example.com', FUNMARY_TOKEN: 'fmy_secret' },
		});
	});

	it('人が読める形 (字下げあり) で出す', () => {
		expect(buildMcpConfig('https://funmary.example.com', 'fmy_x')).toContain('\n\t"mcpServers"');
	});
});

describe('buildLoginCommand', () => {
	it('接続先を埋めたコマンドにする。トークンは含めない (シェルの履歴に残さないため)', () => {
		const command = buildLoginCommand('https://funmary.example.com');
		expect(command).toBe('npx funmary login --url https://funmary.example.com');
		expect(command).not.toContain('fmy_');
	});
});
