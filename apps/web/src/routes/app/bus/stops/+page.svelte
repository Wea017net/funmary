<script lang="ts">
	import { resolve } from '$app/paths';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import IconBack from '~icons/material-symbols/arrow-back';
	import IconCheck from '~icons/material-symbols/check';

	let {
		data,
	}: {
		data: {
			stops: { id: string; name: string }[];
			selectedStopId: string | null;
			direction: 'toUniversity' | 'fromUniversity' | null;
			day: 'weekday' | 'holiday' | null;
		};
	} = $props();

	/** 選んだら、バスの画面に戻る。向きと日の区分は、そのまま引き継ぐ */
	const choose = (stopId: string) => {
		const query = new SvelteURLSearchParams({ stop: stopId });
		if (data.direction) query.set('direction', data.direction);
		if (data.day) query.set('day', data.day);
		return `${resolve('app/bus')}?${query.toString()}`;
	};
</script>

<svelte:head>
	<title>バス停の選択 - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page page-w-48">
	<a class="back" href={resolve('app/bus')}><IconBack aria-hidden="true" />バスに戻る</a>
	<h1>バス停選択</h1>
	<p class="muted">
		未来大との間を行き来する、乗り降りするバス停を選んでください。選んだバス停は、次に開いたときも使います。
	</p>
	<ul class="stops">
		{#each data.stops as stop (stop.id)}
			<li>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve 済みの /app/bus に、停留所を足している -->
				<a
					href={choose(stop.id)}
					aria-current={stop.id === data.selectedStopId ? 'true' : undefined}
				>
					<span>{stop.name}</span>
					{#if stop.id === data.selectedStopId}<IconCheck aria-hidden="true" />{/if}
				</a>
			</li>
		{/each}
	</ul>
</div>

<style lang="scss">
	.back {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		min-height: 44px;
		color: var(--fm-text-muted);
		text-decoration: none;
	}

	.stops {
		margin: 1rem 0 0;
		padding: 0;
		list-style: none;

		a {
			display: flex;
			align-items: center;
			justify-content: space-between;
			min-height: 52px;
			padding: 0 0.5rem;
			border-bottom: 1px dashed var(--fm-divider);
			color: var(--fm-text);
			text-decoration: none;
		}

		a:hover {
			background: var(--fm-surface-muted);
		}

		a[aria-current='true'] {
			color: var(--fm-primary);
			font-weight: 700;
		}
	}
</style>
