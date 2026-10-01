// 作者自身の SSH 鍵で VPS に入るための部品 (pnpm env:upload と pnpm vps:restart が使う)。
// 接続先 (宛先、鍵、ポート) は、コマンドの引数ではなく .env.ssh に書く
// (シェルの履歴やプロセス一覧に、接続先や鍵の場所を残さないため)。形は .env.ssh.example を見る。
//
// パスワードやパスフレーズは聞かず、鍵だけで入る (BatchMode)。操作ごとに接続し直すので、聞くと何度も打つことになるうえ、
// Windows の OpenSSH は、標準入力に流したデータをパスフレーズとして読んでしまい、正しく打っても失敗することがあるため。
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * @typedef {object} SshConfig
 * @property {string} host ユーザー名を含む宛先 (例: root@funmary.example.com)
 * @property {string} [port]
 * @property {string} [key] 秘密鍵のパス
 */

/**
 * @param {SshConfig} config
 * @param {readonly string[]} remote VPS で動かすコマンド
 * @returns {string[]}
 */
export function sshArgs(config, remote) {
	return [
		'-o',
		'BatchMode=yes',
		// 鍵を書いたときは、その鍵だけを使う (ssh-agent のほかの鍵を順に試して、回数制限で断られないように)
		...(config.key ? ['-o', 'IdentitiesOnly=yes'] : []),
		...(config.port ? ['-p', config.port] : []),
		...(config.key ? ['-i', config.key] : []),
		config.host,
		...remote,
	];
}

/**
 * VPS のシェルに渡す値を、1 つの語として ' で囲む (中の ' は ''' にする)
 * @param {string} value
 * @returns {string}
 */
export function shellQuote(value) {
	return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

/**
 * ssh の失敗の出力から、直し方の案内を作る。案内できなければ null
 * @param {string} stderr
 * @returns {string | null}
 */
export function sshFailureHint(stderr) {
	if (!/Permission denied|Too many authentication failures/.test(stderr)) return null;
	return (
		'鍵で VPS に入れませんでした。.env.ssh の SSH_KEY に、VPS に登録した秘密鍵のパスを書いてください ' +
		'(パスフレーズ付きの鍵なら、先に ssh-agent に登録します)。'
	);
}

/** .env.ssh を読む。なければ、作り方を示して止める */
export function loadSshConfig() {
	if (!existsSync('.env.ssh')) {
		console.error(
			'.env.ssh がありません。.env.ssh.example を .env.ssh に写し、接続先を書いてください。',
		);
		process.exit(1);
	}
	process.loadEnvFile('.env.ssh');
	const host = process.env['SSH_HOST'];
	if (!host)
		throw new Error('.env.ssh に SSH_HOST を書いてください (例: root@funmary.example.com)');
	const port = process.env['SSH_PORT'];
	const key = process.env['SSH_KEY'];
	return {
		/** @type {SshConfig} */
		ssh: { host, ...(port ? { port } : {}), ...(key ? { key } : {}) },
		remoteEnvFile: process.env['REMOTE_ENV_FILE'] || '/etc/funmary/funmary.env',
	};
}

/**
 * VPS でコマンドを動かし、標準出力を返す。input を渡さなければ、標準入力は渡さない
 * @param {SshConfig} config
 * @param {readonly string[]} remote
 * @param {{ input?: string }} [options]
 * @returns {string}
 */
export function runSsh(config, remote, options = {}) {
	try {
		return execFileSync('ssh', sshArgs(config, remote), {
			encoding: 'utf8',
			stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
			...(options.input === undefined ? {} : { input: options.input }),
		});
	} catch (error) {
		const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr) : '';
		if (stderr) process.stderr.write(stderr);
		const hint = sshFailureHint(stderr);
		if (hint) console.error(hint);
		throw error;
	}
}

/**
 * Funmary を再起動し、動いているかを確かめる。1 回の接続で済ませる
 * @param {SshConfig} config
 * @returns {boolean} 動いていれば true
 */
export function restartFunmary(config) {
	console.log(`${config.host} の Funmary を再起動しています…`);
	let state;
	try {
		// 起動の直後に落ちることもあるので、少し待ってから状態を見る
		state = runSsh(config, [
			'sudo systemctl restart funmary && sleep 3; systemctl is-active funmary',
		]).trim();
	} catch (error) {
		// 動いていなければ is-active は 0 以外で終わるので、状態は例外の標準出力から読む
		state =
			(error instanceof Error && 'stdout' in error ? String(error.stdout).trim() : '') || '不明';
	}
	if (state === 'active') {
		console.log('再起動しました。Funmary は動いています。');
		return true;
	}
	console.error(
		`再起動のあとの状態が ${state} です。VPS で journalctl -u funmary -n 50 を見て、原因を確かめてください。`,
	);
	return false;
}
