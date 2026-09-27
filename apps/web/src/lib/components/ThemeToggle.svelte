<script lang="ts">
	import IconDark from '~icons/material-symbols/dark-mode-outline';
	import IconLight from '~icons/material-symbols/light-mode-outline';
	import IconSystem from '~icons/material-symbols/brightness-auto-outline';
	import { nextThemePreference, THEME_COOKIE, type ThemePreference } from '$lib/theme.ts';

	// 画面の色を、端末の設定、ライト、ダークの順に切り替える。設定は Cookie に置き、次の読み込みではサーバーが反映する
	let { initial, compact = false }: { initial: ThemePreference; compact?: boolean } = $props();

	let theme = $derived(initial);

	const LABELS: Record<ThemePreference, string> = {
		system: '端末の設定',
		light: 'ライト',
		dark: 'ダーク',
	};
	const ICONS = { system: IconSystem, light: IconLight, dark: IconDark };

	const Icon = $derived(ICONS[theme]);

	function cycle() {
		const next = nextThemePreference(theme);
		theme = next;
		document.documentElement.dataset['theme'] = next;
		const secure = location.protocol === 'https:' ? '; secure' : '';
		document.cookie =
			next === 'system'
				? `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`
				: `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax${secure}`;
	}
</script>

<button
	type="button"
	class={['toggle', { compact }]}
	onclick={cycle}
	aria-label={`画面の色: ${LABELS[theme]} (押すと${LABELS[nextThemePreference(theme)]}に切り替えます)`}
>
	<Icon aria-hidden="true" class="icon" />
	{#if !compact}<span>{LABELS[theme]}</span>{/if}
</button>

<style>
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		min-width: 48px;
		min-height: 48px;
		padding: 0 0.75rem;
		border: 0;
		border-radius: 0.5rem;
		background: none;
		color: var(--fm-text-muted);
		font: inherit;
		font-size: 0.875rem;
		cursor: pointer;
	}
	.toggle:hover {
		background: var(--fm-surface-muted);
		color: var(--fm-text);
	}
	.compact {
		justify-content: center;
		padding: 0;
	}
	.toggle :global(.icon) {
		width: 1.5rem;
		height: 1.5rem;
	}
</style>
