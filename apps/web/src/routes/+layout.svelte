<script lang="ts">
	import '$lib/styles/generated/smui.css';
	import '$lib/styles/base.scss';
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import MaskedEmail from '$lib/components/MaskedEmail.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import type { ThemePreference } from '$lib/theme.ts';
	import IconAdmin from '~icons/material-symbols/shield-person-outline';
	import IconCourses from '~icons/material-symbols/menu-book-outline';
	import IconLogout from '~icons/material-symbols/logout';
	import IconToday from '~icons/material-symbols/today-outline';
	import IconWeek from '~icons/material-symbols/calendar-view-week-outline';

	let {
		data,
		children,
	}: {
		data: { user: { email: string; isAdmin: boolean } | null; theme: ThemePreference };
		children: Snippet;
	} = $props();

	// PC では左のメニュー、スマホでは下のタブに同じ項目を出す (設計書 12.4)
	const items = $derived([
		{ href: resolve('/'), label: '今日', icon: IconToday, current: page.url.pathname === '/' },
		{
			href: resolve('/week'),
			label: '時間割',
			icon: IconWeek,
			current: page.url.pathname.startsWith('/week'),
		},
		{
			href: resolve('/courses'),
			label: '履修科目',
			icon: IconCourses,
			current:
				page.url.pathname.startsWith('/courses') || page.url.pathname.startsWith('/subjects'),
		},
		...(data.user?.isAdmin
			? [
					{
						href: resolve('/admin'),
						label: '管理',
						icon: IconAdmin,
						current: page.url.pathname.startsWith('/admin'),
					},
				]
			: []),
	]);
</script>

{#snippet navItems(className: string)}
	<ul class={className}>
		{#each items as item (item.href)}
			<li>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href は resolve 済み -->
				<a href={item.href} aria-current={item.current ? 'page' : undefined}>
					<item.icon aria-hidden="true" class="icon" />
					<span>{item.label}</span>
				</a>
			</li>
		{/each}
	</ul>
{/snippet}

{#snippet logout()}
	<!-- /auth は、サーバーが処理する。SvelteKit の form の処理を通さず、通常の送信にする -->
	<form method="POST" action="/auth/logout" data-sveltekit-reload>
		<button type="submit" class="logout">
			<IconLogout aria-hidden="true" class="icon" />
			<span>ログアウト</span>
		</button>
	</form>
{/snippet}

{#snippet unofficial()}
	<p class="unofficial">Funmary は公立はこだて未来大学の公式のアプリではありません。</p>
{/snippet}

{#if data.user}
	<div class="shell">
		<header class="top">
			<a class="brand" href={resolve('/')}>Funmary</a>
			<div class="top-actions">
				<ThemeToggle initial={data.theme} compact />
				{@render logout()}
			</div>
		</header>

		<nav class="side" aria-label="メニュー">
			<a class="brand" href={resolve('/')}>Funmary</a>
			{@render navItems('side-items')}
			<div class="account">
				<div class="email"><MaskedEmail email={data.user.email} /></div>
				<ThemeToggle initial={data.theme} />
				{@render logout()}
			</div>
		</nav>

		<main>
			{@render children()}
			<footer>{@render unofficial()}</footer>
		</main>

		<nav class="tabs" aria-label="メニュー">
			{@render navItems('tab-items')}
		</nav>
	</div>
{:else}
	<main class="solo">
		{@render children()}
		<footer>
			{@render unofficial()}
			<ThemeToggle initial={data.theme} />
		</footer>
	</main>
{/if}

<style lang="scss">
	@use 'breakpoints';

	.shell {
		min-height: 100dvh;
	}

	main {
		box-sizing: border-box;
		max-width: 72rem;
		padding: 1rem 1rem 6rem;
	}

	.solo {
		max-width: 40rem;
		margin: 0 auto;
		padding-bottom: 2rem;
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

	.logout {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		min-height: 48px;
		padding: 0 0.75rem;
		border: 0;
		border-radius: 0.5rem;
		background: none;
		color: var(--fm-text-muted);
		font: inherit;
		font-size: 0.875rem;
		cursor: pointer;

		&:hover {
			background: var(--fm-surface-muted);
			color: var(--fm-text);
		}
	}

	/* スマホ: 上に名前、下にタブ */
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.25rem 0.5rem 0.25rem 1rem;
		border-bottom: 1px dashed var(--fm-divider);
	}

	.side {
		display: none;
	}

	.tabs {
		position: fixed;
		inset: auto 0 0;
		z-index: 1;
		border-top: 1px solid var(--fm-divider);
		background: var(--fm-surface);
		padding-bottom: env(safe-area-inset-bottom);
	}

	.tabs .tab-items {
		display: flex;
		margin: 0;
		padding: 0;
		list-style: none;

		li {
			flex: 1;
		}

		a {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 0.125rem;
			min-height: 56px;
			padding: 0.375rem 0 0.25rem;
			color: var(--fm-text-muted);
			font-size: 0.75rem;
			text-decoration: none;
		}

		a :global(.icon) {
			padding: 0.125rem 1rem;
			border-radius: 1rem;
			transition: background-color 150ms ease-out;
		}

		a[aria-current='page'] {
			color: var(--fm-primary);
			font-weight: 700;
		}

		a[aria-current='page'] :global(.icon) {
			background: var(--fm-primary-soft);
		}
	}

	/* PC: 左に常に出すメニュー */
	@include breakpoints.wide {
		.shell {
			display: grid;
			grid-template-columns: 15rem minmax(0, 1fr);
		}

		.top,
		.tabs {
			display: none;
		}

		.side {
			position: sticky;
			top: 0;
			display: flex;
			flex-direction: column;
			gap: 1.5rem;
			box-sizing: border-box;
			height: 100dvh;
			padding: 1.5rem 1rem;
			border-right: 1px dashed var(--fm-divider);
		}

		.side .brand {
			padding: 0 0.75rem;
		}

		main {
			padding: 2rem 2.5rem 3rem;
		}

		.solo {
			padding: 2rem 1rem;
		}
	}

	.side .side-items {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;

		a {
			display: flex;
			align-items: center;
			gap: 0.75rem;
			min-height: 44px;
			padding: 0 0.75rem;
			border: 1px solid transparent;
			border-radius: 0.5rem;
			color: var(--fm-text-muted);
			text-decoration: none;
			transition:
				background-color 150ms ease-out,
				color 150ms ease-out;
		}

		a:hover {
			background: var(--fm-surface-muted);
			color: var(--fm-text);
		}

		a[aria-current='page'] {
			border-color: var(--fm-divider);
			background: var(--fm-surface);
			color: var(--fm-text);
			font-weight: 700;
		}

		a[aria-current='page'] :global(.icon) {
			color: var(--fm-primary);
		}
	}

	.account {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		margin-top: auto;
		padding-top: 1rem;
		border-top: 1px dashed var(--fm-divider);
	}

	.email {
		padding-left: 0.75rem;
		color: var(--fm-text-muted);
		font-size: 0.8125rem;
	}

	.top-actions {
		display: flex;
		align-items: center;
	}
</style>
