/// <reference types="unplugin-icons/types/svelte" />
// SvelteKit の型の拡張。https://svelte.dev/docs/kit/types#app.d.ts
import type { AuthUser } from '@funmary/db';
import type { ThemePreference } from '$lib/theme.ts';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** ログインしている利用者。ログインしていなければ null */
			user: AuthUser | null;
			/** 画面の色の設定 (Cookie から読む) */
			theme: ThemePreference;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
