import { describe, expect, it } from 'vitest';
import * as client from './index.ts';
import * as mcp from './mcp.ts';

describe('ライブラリの入口', () => {
	it('funmary から、公開 API のクライアントを使える', () => {
		expect(typeof client.createFunmaryClient).toBe('function');
		expect(typeof client.FunmaryApiError).toBe('function');
	});

	it('funmary/mcp から、MCP サーバーの組み立てを使える', () => {
		expect(typeof mcp.createFunmaryMcpServer).toBe('function');
		expect(typeof mcp.createClientData).toBe('function');
		expect(mcp.TOOLS.length).toBeGreaterThan(20);
	});
});
