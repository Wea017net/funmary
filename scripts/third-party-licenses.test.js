import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateThirdPartyLicenses } from './third-party-licenses.js';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('generateThirdPartyLicenses', () => {
	it('ルートに依存がないモノレポでも、各パッケージの本番の依存を並べる (#279)', () => {
		const text = generateThirdPartyLicenses(root);

		expect(text).toContain('\nbetter-sqlite3 ');
		expect(text).toContain('ライセンス: ');
	}, 60_000);
});
