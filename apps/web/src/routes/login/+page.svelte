<script lang="ts">
	import Button, { Label } from '@smui/button';
	import { page } from '$app/state';
	import { loginErrorMessage } from '$lib/login-error.ts';

	const message = $derived(loginErrorMessage(page.url.searchParams.get('error')));
</script>

<svelte:head>
	<title>ログイン - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<h1>ログイン</h1>

	{#if message}
		<p class="error" role="alert">{message}</p>
	{/if}

	<p>大学の Google アカウント (@fun.ac.jp) でログインします。</p>
	<!-- /auth は SvelteKit の画面ではなく、サーバーが処理するので、ページの遷移ではなく通常の移動にする -->
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- 画面の経路ではなく、サーバーの口 -->
	<p>
		<Button href="/auth/google" variant="unelevated" data-sveltekit-reload>
			<Label>Google でログイン</Label>
		</Button>
	</p>
</div>

<style>
	.page {
		max-width: 40rem;
	}
	.error {
		padding: 0.75rem 1rem;
		border: 1px solid currentcolor;
		border-radius: 0.25rem;
		color: var(--fm-error);
	}
</style>
