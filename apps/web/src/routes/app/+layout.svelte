<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import AboutApp, { type About } from '$lib/components/AboutApp.svelte';
	import FooterLinks from '$lib/components/FooterLinks.svelte';
	import MaskedEmail from '$lib/components/MaskedEmail.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import type { ThemePreference } from '$lib/theme.ts';
	import IconCourses from '~icons/material-symbols/menu-book-outline';
	import IconSettings from '~icons/material-symbols/settings-outline';
	import IconToday from '~icons/material-symbols/today-outline';
	import IconWeek from '~icons/material-symbols/calendar-view-week-outline';

	// スマホの上部バーは、下へのスクロールで隠し、上へのスクロールで出す (設計書、Issue #109)。
	// ページの一番上では常に出す。隠れているかは、週の時間割の見出しの貼り付く位置を決めるのに使う (CSS 変数)
	let header: HTMLElement | undefined = $state();
	let headerHidden = $state(false);

	$effect(() => {
		let lastY = window.scrollY;
		const HIDE_THRESHOLD = 8;
		function onScroll() {
			const y = window.scrollY;
			const delta = y - lastY;
			if (y <= 0) headerHidden = false;
			else if (delta > HIDE_THRESHOLD) headerHidden = true;
			else if (delta < -HIDE_THRESHOLD) headerHidden = false;
			lastY = y;
		}
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	});

	// 見えている高さを、CSS 変数 (--app-header-offset) として document に置く。
	// 幅が広い画面では、この上部バー自体を出していないので、常に 0 になる
	$effect(() => {
		const offset = header && !headerHidden ? header.offsetHeight : 0;
		document.documentElement.style.setProperty('--app-header-offset', `${offset}px`);
	});

	let {
		data,
		children,
	}: {
		data: {
			user: { email: string };
			theme: ThemePreference;
			about: About;
			operator: { name: string; url: string } | null;
		};
		children: Snippet;
	} = $props();

	// PC では左のメニュー、スマホでは下のタブに同じ項目を出す (設計書 12.4)。
	// 管理は設定の中にあるので、管理の画面を開いているときも設定を選んだ状態にする
	const items = $derived([
		{
			href: resolve('/app'),
			label: '今日',
			icon: IconToday,
			current: page.url.pathname === '/app',
		},
		{
			href: resolve('/app/week'),
			label: '時間割',
			icon: IconWeek,
			current: page.url.pathname.startsWith('/app/week'),
		},
		{
			href: resolve('/app/courses'),
			label: '科目',
			icon: IconCourses,
			current:
				page.url.pathname.startsWith('/app/courses') ||
				page.url.pathname.startsWith('/app/subjects'),
		},
		{
			href: resolve('/app/settings'),
			label: '設定',
			icon: IconSettings,
			current:
				page.url.pathname.startsWith('/app/settings') || page.url.pathname.startsWith('/app/admin'),
		},
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

{#snippet unofficial()}
	<p class="unofficial">Funmary は公立はこだて未来大学の公式のアプリではありません。</p>
	<FooterLinks operator={data.operator} />
{/snippet}

<div class="shell">
	<header class="top" class:hidden={headerHidden} bind:this={header}>
		<a class="brand" href={resolve('/app')}>Funmary</a>
		<div class="top-actions">
			<ThemeToggle initial={data.theme} compact />
		</div>
	</header>

	<nav class="side" aria-label="メニュー">
		<a class="brand" href={resolve('/app')}>Funmary</a>
		{@render navItems('side-items')}
		<div class="account">
			<div class="email"><MaskedEmail email={data.user.email} /></div>
			<ThemeToggle initial={data.theme} />
		</div>
	</nav>

	<main>
		{@render children()}
		<footer>
			{@render unofficial()}
			<AboutApp about={data.about} />
		</footer>
	</main>

	<nav class="tabs" aria-label="メニュー">
		{@render navItems('tab-items')}
	</nav>
</div>

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

	/* 左のメニューでは、画面の色のボタンを、横幅いっぱいの高さにそろえる */
	.account :global(.toggle) {
		justify-content: flex-start;
		width: 100%;
		height: 48px;
	}

	/* スマホ: 上に名前、下にタブ。上のバーは貼り付け、下へのスクロールで隠す (Issue #109) */
	.top {
		position: sticky;
		top: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.25rem 0.5rem 0.25rem 1rem;
		border-bottom: 1px dashed var(--fm-divider);
		background: var(--fm-surface);
		transition: transform 200ms ease-out;

		&.hidden {
			transform: translateY(-100%);
		}

		@media (prefers-reduced-motion: reduce) {
			transition: none;
		}
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
			/* 高さが足りないときは、下の要素を上の要素に重ねず、メニューの中でスクロールする */
			overflow-y: auto;
			padding: 1.5rem 1rem;
			border-right: 1px dashed var(--fm-divider);
		}

		.side .brand {
			padding: 0 0.75rem;
		}

		main {
			padding: 2rem 2.5rem 3rem;
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
		flex-shrink: 0;
		margin-top: auto;
		padding-top: 1rem;
		border-top: 1px dashed var(--fm-divider);
	}

	.email {
		width: 100%;
		color: var(--fm-text-muted);
		font-size: 0.8125rem;
	}

	.top-actions {
		display: flex;
		align-items: center;
	}
</style>
