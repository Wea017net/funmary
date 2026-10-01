<script lang="ts">
	import '$lib/styles/generated/smui.css';
	import '$lib/styles/base.scss';
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import AboutApp, { type About } from '$lib/components/AboutApp.svelte';
	import BrandLogo from '$lib/components/BrandLogo.svelte';
	import FooterLinks from '$lib/components/FooterLinks.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import type { ThemePreference } from '$lib/theme.ts';

	let {
		data,
		children,
	}: {
		data: {
			theme: ThemePreference;
			about: About;
			operator: { name: string; url: string } | null;
		};
		children: Snippet;
	} = $props();

	// アプリ (/app の下) は、メニューのある枠を app/+layout.svelte で付ける。
	// ここでは、紹介、ログイン、エラーの画面に、名前と画面の色のボタンだけの簡素な枠を付ける
	const inApp = $derived(page.url.pathname === '/app' || page.url.pathname.startsWith('/app/'));
</script>

{#if inApp}
	{@render children()}
{:else}
	<header class="guest-top">
		<a class="brand" href={resolve('/')}><BrandLogo height="1.75rem" /></a>
		<ThemeToggle initial={data.theme} compact />
	</header>
	<main class="solo">
		{@render children()}
		<footer>
			<p class="unofficial">Funmary は公立はこだて未来大学の公式のアプリではありません。</p>
			<FooterLinks operator={data.operator} />
			<AboutApp about={data.about} />
		</footer>
	</main>
{/if}

<style lang="scss">
	@use 'breakpoints';

	.guest-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		max-width: 64rem;
		margin: 0 auto;
		padding: 0.25rem 0.5rem 0.25rem 1rem;
	}

	.solo {
		box-sizing: border-box;
		max-width: 64rem;
		margin: 0 auto;
		padding: 1rem 1rem 2rem;
	}

	footer {
		margin-top: 3rem;
		padding-top: 1rem;
		border-top: 1px dashed var(--fm-divider);
	}

	.unofficial {
		margin: 0;
		color: var(--fm-text-muted);
		font-size: 0.8125rem;
	}

	.brand {
		color: var(--fm-primary);
		font-weight: 700;
		font-size: 1.125rem;
		letter-spacing: 0.02em;
		text-decoration: none;
	}

	:global(.icon) {
		flex: none;
		width: 1.5rem;
		height: 1.5rem;
	}

	@include breakpoints.wide {
		.solo {
			padding: 2rem 1rem;
		}
	}
</style>
