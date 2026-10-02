import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './apps/web/svelte.config.js';

export default defineConfig(
	{
		ignores: [
			'**/build/',
			'**/.svelte-kit/',
			'**/dist/',
			'**/coverage/',
			'**/playwright-report/',
			'**/test-results/',
			// wrangler types が作る型と、wrangler dev が手元に作る状態
			'**/worker-configuration.d.ts',
			'**/.wrangler/',
			// pnpm package-release が作るリリース
			'release/',
			'.agents/',
			'.private/',
		],
	},
	js.configs.recommended,
	ts.configs.recommendedTypeChecked,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node },
			parserOptions: { projectService: true, extraFileExtensions: ['.svelte'] },
		},
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: { parserOptions: { parser: ts.parser, svelteConfig } },
	},
	{
		// 設定ファイルなどの .js は型の検査の対象外にする
		files: ['**/*.js'],
		ignores: ['scripts/**', 'apps/web/scripts/**'],
		extends: [ts.configs.disableTypeChecked],
	},
);
