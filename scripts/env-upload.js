// 本番の環境変数ファイルを、手元の .env に合わせる (VPS にログインせず、1 つのコマンドで済ませる)。
// 使い方: pnpm env:upload
// SSH でつなぐための秘匿情報 (宛先、鍵、ポート) は、コマンドの引数ではなく .env.ssh に書く
// (シェルの履歴やプロセス一覧に、接続先や鍵の場所を残さないため)。形は .env.ssh.example を見る。
//
// 反映専用の制限された鍵 (funmary-deploy、command= で funmary-update だけに絞ったもの) は使わない。
// 作者自身の SSH 鍵と sudo を使う (自動デプロイの経路とは別)。
//
// 1. リモートの環境変数ファイルを .env.example の並びに揃える (足りない鍵を空のまま足す。値は変えない)
// 2. 手元の .env にあって、リモートにない値、またはリモートと違う値だけを、1 つずつ上書きするか確認する
//    (どちらにもない鍵、リモートにしかない鍵には触れない)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { alignEnvFile, parseEnvValues, setEnvValues } from '../apps/web/src/lib/server/env-file.ts';

if (!existsSync('.env.ssh')) {
	console.error(
		'.env.ssh がありません。.env.ssh.example を .env.ssh に写し、接続先を書いてください。',
	);
	process.exit(1);
}
process.loadEnvFile('.env.ssh');

const host = process.env['SSH_HOST'];
if (!host) throw new Error('.env.ssh に SSH_HOST を書いてください (例: root@funmary.example.com)');
const remoteFile = process.env['REMOTE_ENV_FILE'] || '/etc/funmary/funmary.env';
const sshPort = process.env['SSH_PORT'];
const sshKey = process.env['SSH_KEY'];

if (!existsSync('.env')) throw new Error('.env がありません (pnpm funmary-admin init で作れます)');
if (!existsSync('.env.example')) throw new Error('.env.example が見つかりません');
const localText = readFileSync('.env', 'utf8');
const templateText = readFileSync('.env.example', 'utf8');

/** @param {string[]} args @returns {string[]} */
const withConnectionArgs = (args) => [
	...(sshPort ? ['-p', sshPort] : []),
	...(sshKey ? ['-i', sshKey] : []),
	...args,
];
/** @param {string[]} args @returns {string} */
const ssh = (args) =>
	execFileSync('ssh', withConnectionArgs([host, ...args]), { encoding: 'utf8' });

console.log(`${host} の ${remoteFile} を読んでいます…`);
const remoteText = ssh(['sudo', 'cat', remoteFile]);

// まず、リモートの並びと足りない鍵を .env.example に揃える (値のある行の値は変えない)
const structured = alignEnvFile(remoteText, templateText);
if (structured.added.length > 0) {
	console.log(`空のまま足す鍵: ${structured.added.join(', ')}`);
}
if (structured.extra.length > 0) {
	console.log(`.env.example にない鍵 (そのまま残す): ${structured.extra.join(', ')}`);
}

// 手元の .env と、揃えたあとのリモートの値を見比べる
const localValues = parseEnvValues(localText);
const remoteValues = parseEnvValues(structured.text);
/** @type {{ key: string, local: string, remote: string }[]} */
const changed = [];
for (const [key, local] of localValues) {
	if (local === '') continue; // 手元でも空なら、上書きの提案はしない
	const remote = remoteValues.get(key) ?? '';
	if (local === remote) continue;
	changed.push({ key, local, remote });
}

/** @type {Map<string, string>} */
const overrides = new Map();
if (changed.length > 0) {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		console.log(
			`\n手元の .env と値が違う、またはリモートにない鍵が ${changed.length} 件あります。`,
		);
		for (const [i, { key, local, remote }] of changed.entries()) {
			console.log(`\n[${i + 1}/${changed.length}] ${key}`);
			console.log(`  手元: ${local}`);
			console.log(`  VPS : ${remote === '' ? '(未設定)' : remote}`);
			const answer = await rl.question('  手元の値で上書きしますか? (y/N): ');
			if (/^y(es)?$/i.test(answer.trim())) overrides.set(key, local);
		}
	} finally {
		rl.close();
	}
} else {
	console.log('手元の .env と値の違いはありません。');
}

if (overrides.size === 0 && structured.text === remoteText) {
	console.log('\n変えるものがないので、何もしていません。');
	process.exit(0);
}

const finalText = setEnvValues(structured.text, overrides);

const backupPath = `${remoteFile}.bak.${new Date().toISOString().replaceAll(/[:.]/g, '-')}`;
console.log(`\n${host} の ${remoteFile} を ${backupPath} に控えてから書き換えます…`);
ssh(['sudo', 'cp', '-p', remoteFile, backupPath]);
// 既存のファイルに上書きするので、所有者と権限 (root:funmary、640) は変わらない
execFileSync('ssh', withConnectionArgs([host, 'sudo', 'tee', remoteFile]), {
	input: finalText,
	stdio: ['pipe', 'ignore', 'inherit'],
});

console.log(
	`書き換えました。上書きした鍵: ${overrides.size > 0 ? [...overrides.keys()].join(', ') : 'なし'}`,
);
if (overrides.size > 0) {
	console.log('本番に反映するには、Funmary を再起動してください: sudo systemctl restart funmary');
}
