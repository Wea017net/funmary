// static/icon.svg から、PWA のアイコン (PNG) を作り直す。アイコンの絵を変えたときだけ、手で実行する (pnpm --filter @funmary/web build:icons)。
// 背景は角を丸めず塗りつぶす。丸める処理は、OS が行う (maskable にも使えるよう、字は中央の 60% に収める)。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const staticDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'static');
const svg = readFileSync(join(staticDir, 'icon.svg'), 'utf8');

const OUTPUTS = [
	{ name: 'icon-192.png', size: 192 },
	{ name: 'icon-512.png', size: 512 },
	// iOS のホーム画面用
	{ name: 'apple-touch-icon.png', size: 180 },
];

const browser = await chromium.launch();
try {
	for (const { name, size } of OUTPUTS) {
		const page = await browser.newPage({ viewport: { width: size, height: size } });
		await page.setContent(
			`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
		);
		writeFileSync(join(staticDir, name), await page.screenshot({ type: 'png' }));
		await page.close();
		console.log(`${name} を作りました`);
	}
} finally {
	await browser.close();
}
