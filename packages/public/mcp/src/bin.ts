#!/usr/bin/env node
// npx -y @funmary/mcp で起動する入口。接続先とトークンは、環境変数で受け取る。
import { runStdioServer } from './stdio.ts';

const baseURL = process.env['FUNMARY_URL'];
const token = process.env['FUNMARY_TOKEN'];
if (!baseURL || !token) {
	console.error(
		'環境変数 FUNMARY_URL (Funmary のサーバーの URL) と FUNMARY_TOKEN (個人用のアクセストークン) を設定してください',
	);
	process.exit(1);
}
runStdioServer({ baseURL, token }).catch((error: unknown) => {
	// トークンは、メッセージに含まれない
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
