// 接続先 (URL) と、個人用のアクセストークンの保存。OS の設定の置き場所に、自分だけが読める権限で書く。
// トークンは、画面にもログにも出さない。接続先の既定値は持たない。
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface StoredConfig {
	readonly baseURL: string;
	readonly token: string;
}

export interface ConfigEnvironment {
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly platform: NodeJS.Platform;
	readonly home: string;
}

/** 設定の置き場所。FUNMARY_CONFIG_DIR があればそこ。なければ、OS の決まりの場所 */
export function configDir({ env, platform, home }: ConfigEnvironment): string {
	const override = env['FUNMARY_CONFIG_DIR'];
	if (override) return override;
	if (platform === 'win32')
		return join(env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'funmary');
	if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'funmary');
	return join(env['XDG_CONFIG_HOME'] ?? join(home, '.config'), 'funmary');
}

const fileOf = (environment: ConfigEnvironment) => join(configDir(environment), 'config.json');

/** 環境変数 FUNMARY_URL と FUNMARY_TOKEN が、保存した値より先。どちらかが欠ければ、保存した値を使う */
export function loadConfig(environment: ConfigEnvironment): StoredConfig | null {
	const stored = readStored(environment);
	const baseURL = environment.env['FUNMARY_URL'] || stored?.baseURL;
	const token = environment.env['FUNMARY_TOKEN'] || stored?.token;
	return baseURL && token ? { baseURL, token } : null;
}

function readStored(environment: ConfigEnvironment): StoredConfig | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(fileOf(environment), 'utf8'));
		if (typeof parsed !== 'object' || parsed === null) return null;
		const record = parsed as Record<string, unknown>;
		return typeof record['baseURL'] === 'string' && typeof record['token'] === 'string'
			? { baseURL: record['baseURL'], token: record['token'] }
			: null;
	} catch {
		return null;
	}
}

/** 保存する。ディレクトリは自分だけ (0700)、ファイルも自分だけが読める (0600) 権限にする */
export function saveConfig(environment: ConfigEnvironment, config: StoredConfig): string {
	const dir = configDir(environment);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const file = fileOf(environment);
	writeFileSync(file, `${JSON.stringify(config, null, '\t')}\n`, { mode: 0o600 });
	// すでにあったファイルの権限は、writeFileSync の mode では変わらない
	chmodSync(file, 0o600);
	return file;
}

/** 保存した設定を消す。なければ false */
export function deleteConfig(environment: ConfigEnvironment): boolean {
	if (!readStored(environment)) return false;
	rmSync(fileOf(environment), { force: true });
	return true;
}
