#!/usr/bin/env node
// funmary コマンドの入口。本物の端末、環境変数、設定の置き場所、通信を、cli.ts に渡す。
import { createFunmaryClient } from '@funmary/client';
import { runStdioServer } from '@funmary/mcp';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { run } from './cli.ts';

function packageVersion(): string {
	try {
		const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
		return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
	} catch {
		return '0.0.0';
	}
}

/** 端末なら、入力を画面に出さずに尋ねる。パイプなら、標準入力を全部読む (シェルの履歴にトークンを残さないため) */
async function readToken(): Promise<string> {
	if (!process.stdin.isTTY) {
		let data = '';
		for await (const chunk of process.stdin) data += String(chunk);
		return data;
	}
	process.stderr.write('アクセストークン (入力は表示されません): ');
	const silent = new Writable({ write: (_chunk, _encoding, done) => done() });
	const lines = createInterface({ input: process.stdin, output: silent, terminal: true });
	return new Promise((resolve) => {
		lines.question('', (answer) => {
			lines.close();
			process.stderr.write('\n');
			resolve(answer);
		});
	});
}

process.exitCode = await run(process.argv.slice(2), {
	env: process.env,
	platform: process.platform,
	home: homedir(),
	now: () => new Date(),
	out: (line) => console.log(line),
	err: (line) => console.error(line),
	width: process.stdout.columns ?? 80,
	isTTY: process.stdout.isTTY,
	readToken,
	createClient: ({ baseURL, token }) => createFunmaryClient({ baseURL, token }),
	runMcp: ({ baseURL, token }) => runStdioServer({ baseURL, token, version: packageVersion() }),
	version: packageVersion(),
});
