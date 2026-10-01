// 本番の Funmary を再起動し、動いているかを確かめる (VPS にログインせず、1 つのコマンドで済ませる)。
// 使い方: pnpm vps:restart
// SSH の接続先は .env.ssh に書く (scripts/vps-ssh.js)。作者自身の SSH 鍵と sudo を使う (自動デプロイの経路とは別)。
import { loadSshConfig, restartFunmary } from './vps-ssh.js';

const { ssh } = loadSshConfig();
if (!restartFunmary(ssh)) process.exitCode = 1;
