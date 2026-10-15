import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	configDir,
	deleteConfig,
	loadConfig,
	saveConfig,
	type ConfigEnvironment,
} from './config.ts';

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sandbox(env: Record<string, string> = {}): ConfigEnvironment {
	const dir = mkdtempSync(join(tmpdir(), 'funmary-cli-'));
	dirs.push(dir);
	return { env: { FUNMARY_CONFIG_DIR: dir, ...env }, platform: 'linux', home: dir };
}

describe('configDir', () => {
	const home = '/home/u';
	it('OS ごとの、設定の置き場所を返す', () => {
		expect(configDir({ env: {}, platform: 'linux', home })).toBe(join(home, '.config', 'funmary'));
		expect(configDir({ env: { XDG_CONFIG_HOME: '/x' }, platform: 'linux', home })).toBe(
			join('/x', 'funmary'),
		);
		expect(configDir({ env: {}, platform: 'darwin', home })).toBe(
			join(home, 'Library', 'Application Support', 'funmary'),
		);
		expect(
			configDir({ env: { APPDATA: 'C:/Users/u/AppData/Roaming' }, platform: 'win32', home }),
		).toBe(join('C:/Users/u/AppData/Roaming', 'funmary'));
	});

	it('FUNMARY_CONFIG_DIR があれば、それを使う', () => {
		expect(configDir({ env: { FUNMARY_CONFIG_DIR: '/custom' }, platform: 'linux', home })).toBe(
			'/custom',
		);
	});
});

describe('保存と読み込み', () => {
	it('保存した設定を、読み戻せる。なければ null', () => {
		const environment = sandbox();
		expect(loadConfig(environment)).toBeNull();
		saveConfig(environment, { baseURL: 'https://funmary.example.com', token: 'fmy_secret' });
		expect(loadConfig(environment)).toEqual({
			baseURL: 'https://funmary.example.com',
			token: 'fmy_secret',
		});
	});

	it.skipIf(process.platform === 'win32')('ファイルは、自分だけが読める権限 (0600) で書く', () => {
		const environment = sandbox();
		const file = saveConfig(environment, { baseURL: 'https://a.example.com', token: 'fmy_x' });
		expect(statSync(file).mode & 0o777).toBe(0o600);
		// 上書きしても、権限は変わらない
		saveConfig(environment, { baseURL: 'https://b.example.com', token: 'fmy_y' });
		expect(statSync(file).mode & 0o777).toBe(0o600);
	});

	it('環境変数が、保存した値より先。片方だけなら、足りないほうは保存した値を使う', () => {
		const stored = sandbox();
		saveConfig(stored, { baseURL: 'https://stored.example.com', token: 'fmy_stored' });
		const withEnv = (env: Record<string, string>): ConfigEnvironment => ({
			...stored,
			env: { ...stored.env, ...env },
		});
		expect(loadConfig(withEnv({ FUNMARY_TOKEN: 'fmy_env' }))).toEqual({
			baseURL: 'https://stored.example.com',
			token: 'fmy_env',
		});
		expect(loadConfig(withEnv({ FUNMARY_URL: 'https://env.example.com' }))?.baseURL).toBe(
			'https://env.example.com',
		);
	});

	it('壊れたファイルは、ないものとして扱う', () => {
		const environment = sandbox();
		saveConfig(environment, { baseURL: 'https://a.example.com', token: 'fmy_x' });
		const file = join(configDir(environment), 'config.json');
		void file;
		expect(
			loadConfig({ ...environment, env: { FUNMARY_CONFIG_DIR: join(tmpdir(), 'ない') } }),
		).toBeNull();
	});

	it('消せる。なければ false', () => {
		const environment = sandbox();
		expect(deleteConfig(environment)).toBe(false);
		saveConfig(environment, { baseURL: 'https://a.example.com', token: 'fmy_x' });
		expect(deleteConfig(environment)).toBe(true);
		expect(loadConfig(environment)).toBeNull();
	});
});
