import { describe, expect, it } from 'vitest';
import { shellQuote, sshArgs, sshFailureHint } from './vps-ssh.js';

describe('sshArgs', () => {
	it('パスワードやパスフレーズを聞かず、鍵だけで入る', () => {
		const args = sshArgs({ host: 'root@funmary.example.com' }, [
			'systemctl',
			'is-active',
			'funmary',
		]);
		expect(args).toEqual([
			'-o',
			'BatchMode=yes',
			'root@funmary.example.com',
			'systemctl',
			'is-active',
			'funmary',
		]);
	});

	it('ポートと鍵を書いていれば渡す', () => {
		expect(
			sshArgs({ host: 'root@funmary.example.com', port: '2222', key: 'C:/keys/vps' }, ['true']),
		).toEqual([
			'-o',
			'BatchMode=yes',
			'-o',
			'IdentitiesOnly=yes',
			'-p',
			'2222',
			'-i',
			'C:/keys/vps',
			'root@funmary.example.com',
			'true',
		]);
	});
});

describe('sshFailureHint', () => {
	it('鍵で入れなかったときは、SSH_KEY の設定を案内する', () => {
		expect(sshFailureHint('root@203.0.113.1: Permission denied (publickey,password).')).toMatch(
			/SSH_KEY/,
		);
	});

	it('ほかの失敗では、案内を足さない', () => {
		expect(sshFailureHint('cat: /etc/funmary/funmary.env: No such file or directory')).toBeNull();
	});
});

describe('shellQuote', () => {
	it("値を ' で囲み、中の ' は閉じてから入れ直す", () => {
		expect(shellQuote('/etc/funmary/funmary.env')).toBe("'/etc/funmary/funmary.env'");
		expect(shellQuote("it's")).toBe(String.raw`'it'\''s'`);
	});
});
