<script lang="ts">
	import Button, { Label } from '@smui/button';
	import { page } from '$app/state';
	import FormNotice from '#lib/components/FormNotice.svelte';
	import { loginErrorMessage } from '#lib/login-error.ts';

	const message = $derived(loginErrorMessage(page.url.searchParams.get('error')));
</script>

<svelte:head>
	<title>ログイン - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page page-w-40">
	<h1>ログイン</h1>

	<FormNotice error={message} />

	<p>大学の Google アカウント (@fun.ac.jp) でログインします。</p>
	<!-- /auth は SvelteKit の画面ではなく、サーバーが処理するので、ページの遷移ではなく通常の移動にする -->
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- 画面の経路ではなく、サーバーの口 -->
	<p>
		<Button href="/auth/google" variant="unelevated" data-sveltekit-reload>
			<Label>Google でログイン</Label>
		</Button>
	</p>
	<p class="muted">
		管理者が用意したテストアカウントの方は、<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- /auth は、サーバーが処理する -->
		<a href="/auth/google/test" data-sveltekit-reload>テストアカウントでログイン</a>
		から入ります。
	</p>
</div>
