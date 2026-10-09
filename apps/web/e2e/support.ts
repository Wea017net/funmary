// E2E のテストが共有する部品。Google の代わりに、テスト用の OpenID Connect のサーバーを使う。
// サーバーは本物の RS256 で署名した ID トークンを返すので、アプリは本番と同じ手順 (PKCE、state、nonce、署名の検証) を通る。
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createSubjectStore, openDatabase, type Database } from '@funmary/db';
import { expect, test, type Page } from '@playwright/test';
import {
	startMockOidcServer,
	type MockOidcServer,
} from '../../../packages/auth/src/testing/mock-oidc-server.ts';
import { E2E_DATA_DIR } from '../e2e-data-dir.ts';
import { OIDC_PORT } from '../oidc-port.ts';

let server: MockOidcServer | undefined;

const running = (): MockOidcServer => {
	if (!server) throw new Error('useMockOidc() を、テストファイルの先頭で呼んでください');
	return server;
};

/** 次にログインする人と、ID トークンの改ざんを決める。useMockOidc() で立てたサーバーに届く */
export const oidc = {
	setIdentity: (...args: Parameters<MockOidcServer['setIdentity']>) =>
		running().setIdentity(...args),
	tamper: (...args: Parameters<MockOidcServer['tamper']>) => running().tamper(...args),
};

/**
 * テストファイルの先頭で呼ぶ。ファイルの間、テスト用の OpenID Connect のサーバーを立てておく。
 * サーバーの状態 (次にログインする人) を共有するので、ファイルの中のテストは 1 つずつ動かし (describe.configure の serial)、
 * ファイルも 1 つずつ動かす (playwright.config の workers: 1)
 */
export function useMockOidc() {
	test.beforeAll(async () => {
		mkdirSync(E2E_DATA_DIR, { recursive: true });
		server = await startMockOidcServer({
			clientId: 'e2e.apps.googleusercontent.com',
			clientSecret: 'e2e-client-secret',
			port: OIDC_PORT,
			// 失敗したテストのやり直しでは、新しいワーカーがこのサーバーを立て直す。アプリは前の公開鍵を覚えているので、
			// 鍵が変わると ID トークンの検証に失敗し、以降のログインがすべて落ちる。立て直しても同じ鍵を使う
			keyFile: join(E2E_DATA_DIR, 'mock-oidc-key.pem'),
		});
	});

	test.afterAll(async () => {
		await server?.close();
		server = undefined;
	});

	test.afterEach(() => {
		server?.tamper('none');
	});
}

/**
 * ログインする。初めてのログインでは、利用規約への同意の画面が出るので、同意して先へ進む
 * (ほとんどのテストは、同意済みの利用者として始めたいため)。同意の流れそのものは、専用のテストで確かめる
 */
export async function signIn(page: Page) {
	await page.goto('/auth/google');
	if (new URL(page.url()).pathname !== '/consent') return;
	await page.getByLabel('利用規約とプライバシーポリシーに同意します').check();
	await page.getByRole('button', { name: '同意して続ける' }).click();
	await expect(page).not.toHaveURL(/\/consent/);
}

/** テストのサーバーと同じ DB を開いて架空の科目を入れ (何度入れても同じになる)、演習の科目の ID と DB を fn に渡す */
export function seedSubjects<T>(fn: (database: Database, exerciseId: number) => T): T {
	const database = openDatabase(join(E2E_DATA_DIR, 'funmary.db'), {
		backupDir: join(E2E_DATA_DIR, 'backups'),
	});
	try {
		const subjects = createSubjectStore(database);
		const base = {
			academicYear: 2026,
			credits: 2,
			attributes: {},
			syllabus: {},
			syllabusUrl: null,
		};
		const exerciseId = subjects.upsert(
			{
				...base,
				syllabusId: '900001',
				name: '架空の演習Ⅱ1-AB',
				teacher: '架空 一郎',
				term: 'fall',
				attributes: { 配当年次: '2年' },
				syllabus: { 授業の概要: '架空の演習の概要です。' },
				syllabusUrl: 'https://syllabus.example.com/900001',
			},
			new Date(),
		);
		subjects.upsert(
			{ ...base, syllabusId: '900002', name: '架空の講義', teacher: null, term: 'q3' },
			new Date(),
		);
		return fn(database, exerciseId);
	} finally {
		database.close();
	}
}

/** 指定したメールアドレスの利用者 (大学のアカウント) として、ログインして、アプリ (/app) を開く。同意の画面は通り抜ける */
export async function signInAs(page: Page, email: string) {
	oidc.setIdentity({ sub: email, email, email_verified: true, hd: 'fun.ac.jp' });
	await signIn(page);
	await expect(page).toHaveURL('/app');
}
