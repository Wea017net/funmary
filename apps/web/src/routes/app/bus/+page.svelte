<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import IconBus from '~icons/material-symbols/directions-bus-outline';
	import IconChevron from '~icons/material-symbols/chevron-right';
	import IconLocation from '~icons/material-symbols/my-location-outline';
	import IconSchool from '~icons/material-symbols/school-outline';
	import IconStop from '~icons/material-symbols/pin-drop-outline';
	import IconSwap from '~icons/material-symbols/swap-vert';
	import IconWarning from '~icons/material-symbols/warning-outline';
	import { formatMinutesUntil } from '#lib/bus-label.ts';
	import type { PublicBusLeg, PublicLegDeparture } from '@funmary/api';
	import { isNearUniversity } from '@funmary/core';

	type DayType = 'weekday' | 'holiday';
	type Direction = 'toUniversity' | 'fromUniversity';

	let {
		data,
	}: {
		data: {
			stopId: string | null;
			direction: Direction;
			canDecideByLocation: boolean;
			leg: PublicBusLeg | null;
			universityName: string;
			nowTime: string;
			stale: boolean;
			hasStops: boolean;
		};
	} = $props();

	const DAY_LABELS: Record<DayType, string> = { weekday: '平日', holiday: '休日' };

	// 「あと N 分」が古くならないよう、1 分ごとに読み直す
	$effect(() => {
		const timer = setInterval(() => void invalidateAll(), 60 * 1000);
		return () => clearInterval(timer);
	});

	const busUrl = (params: Record<string, string>) => {
		const query = new URLSearchParams(params).toString();
		return query ? `${resolve('app/bus')}?${query}` : resolve('app/bus');
	};

	const leg = $derived(data.leg);
	const toUniversity = $derived(data.direction === 'toUniversity');
	const otherDirection = $derived<Direction>(toUniversity ? 'fromUniversity' : 'toUniversity');
	const isToday = $derived(leg !== null && leg.day === leg.todayDay);

	/** 向きと日の区分を引き継いで、バス停選択の画面へ行く */
	const stopsUrl = $derived.by(() => {
		const query = new SvelteURLSearchParams({ direction: data.direction });
		if (leg && leg.day !== leg.todayDay) query.set('day', leg.day);
		return `${resolve('app/bus/stops')}?${query.toString()}`;
	});

	/** 今日の区分のとき、まだ発車していない最初の便 (これに目印を付けて、一覧をその位置に合わせる) */
	const nextIndex = $derived(
		isToday && leg ? leg.departures.findIndex((departure) => departure.time >= data.nowTime) : -1,
	);
	const untilNext = $derived(leg?.upcoming[0]?.minutesUntil ?? null);

	// 選んだ停留所、向き、日の区分が変わったときだけ、一覧の中を、次の便が見える位置に合わせる
	let list: HTMLElement | undefined = $state();
	let scrolledFor = '';
	$effect(() => {
		const key = `${data.stopId}-${data.direction}-${leg?.day}`;
		if (!list || scrolledFor === key) return;
		scrolledFor = key;
		const next = list.querySelector<HTMLElement>('[data-next]');
		if (next) list.scrollTop = Math.max(next.offsetTop - list.clientHeight / 3, 0);
	});

	// 現在地で向きを決める。未来大の近くなら未来大から出る向き、離れていれば未来大へ向かう向き。
	// 許可の確認を、勝手には出さない。すでに許可されているときだけ自動で決め、そうでなければボタンから
	let locating = $state(false);
	/** 失敗の理由 (許可されなかったか、現在地を取れなかったか)。うまくいったら null */
	let locationProblem = $state<'denied' | 'unavailable' | null>(null);

	function decideByLocation() {
		if (!data.stopId || locating) return;
		locating = true;
		locationProblem = null;
		navigator.geolocation.getCurrentPosition(
			({ coords }) => {
				const direction: Direction = isNearUniversity(coords.latitude, coords.longitude)
					? 'fromUniversity'
					: 'toUniversity';
				locating = false;
				if (direction !== data.direction && data.stopId) {
					void goto(busUrl({ stop: data.stopId, direction }), { replaceState: true });
				}
			},
			(error) => {
				locating = false;
				locationProblem = error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable';
			},
			{ maximumAge: 60_000, timeout: 10_000 },
		);
	}

	// 位置情報が使える端末では、いつでもボタンを出す (URL に向きが付いていても、PWA には URL の欄がなく、決め直せなくなるため)
	const canLocate = $derived(typeof navigator !== 'undefined' && 'geolocation' in navigator);

	// すでに許可されていて、向きを URL で決めていないときだけ、開いたときに自動で決める
	$effect(() => {
		if (!data.canDecideByLocation || !('geolocation' in navigator)) return;
		void navigator.permissions
			?.query({ name: 'geolocation' })
			.then((status) => {
				if (status.state === 'granted') decideByLocation();
			})
			.catch(() => undefined);
	});
</script>

<svelte:head>
	<title>バス - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#snippet row(departure: PublicLegDeparture, index: number)}
	<li
		class={{ past: isToday && nextIndex !== -1 && index < nextIndex, next: index === nextIndex }}
		data-next={index === nextIndex ? '' : undefined}
		aria-current={index === nextIndex ? 'true' : undefined}
	>
		<span class="times">
			<span>{departure.time}</span>
			{#if departure.arrivalTime}<span class="arrow" aria-label="から">→</span><span
					>{departure.arrivalTime}</span
				>{/if}
		</span>
		<span class="detail">
			<span class="routes">{departure.routes.join(' ')}</span>
			{#if departure.destination}{departure.destination}行き{/if}
			{#each departure.marks as mark (mark)}<span class="mark">{mark}</span>{/each}
		</span>
		<span class="section">
			<IconBus aria-hidden="true" />
			<span>{departure.from.name} - {departure.to.name}</span>
			{#if departure.platformName}<span class="platform">{departure.platformName}</span>{/if}
		</span>
		{#if index === nextIndex && untilNext !== null}
			<span class="until">{formatMinutesUntil(untilNext)}</span>
		{/if}
	</li>
{/snippet}

{#snippet universityCard(label: string)}
	<div class="card fixed">
		<IconSchool aria-hidden="true" class="icon" />
		<span class="card-label">{label}</span>
		<span class="card-name">{data.universityName}</span>
	</div>
{/snippet}

{#snippet stopCard(label: string)}
	<a class="card picker" href={stopsUrl}>
		<IconStop aria-hidden="true" class="icon" />
		<span class="card-label">{label}</span>
		<span class="card-name">{leg?.stop.name ?? 'バス停を選ぶ'}</span>
		<IconChevron aria-hidden="true" class="chevron" />
	</a>
{/snippet}

<div class="page page-w-48">
	<h1>バス</h1>

	{#if data.stale}
		<p class="stale" role="status">
			<IconWarning aria-hidden="true" class="icon" />
			<span>時刻表を最後に確かめてから、日がたっています。古いかもしれません。</span>
		</p>
	{/if}

	{#if !data.hasStops || data.stopId === null}
		<p>時刻表は、まだ取り込めていません。しばらくしてからもう一度開いてください。</p>
	{:else}
		<div class="trip">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve 済みの /app/bus に、向きを足している -->
			<a
				class="swap"
				href={busUrl({ stop: data.stopId, direction: otherDirection })}
				aria-label={toUniversity
					? '向きを入れ替える (未来大から出発)'
					: '向きを入れ替える (未来大へ向かう)'}
			>
				<IconSwap aria-hidden="true" />
			</a>
			<div class="cards">
				{#if toUniversity}
					{@render stopCard('出発')}
					{@render universityCard('到着')}
				{:else}
					{@render universityCard('出発')}
					{@render stopCard('到着')}
				{/if}
			</div>
		</div>

		{#if canLocate}
			<p class="hint">
				<button type="button" class="locate" onclick={decideByLocation} disabled={locating}>
					<IconLocation aria-hidden="true" />現在地から向きを決める
				</button>
			</p>
			{#if locationProblem === 'denied'}
				<p class="muted hint" role="status">
					位置情報が許可されていません。端末の設定で、このアプリ (またはブラウザ)
					の位置情報を許可してください。
				</p>
			{:else if locationProblem === 'unavailable'}
				<p class="muted hint" role="status">
					現在地を取れませんでした。少し待って、もう一度試してください。
				</p>
			{/if}
		{/if}

		{#if leg}
			<nav aria-label="日の種類">
				<ul class="days">
					{#each ['weekday', 'holiday'] as const as day (day)}
						<li>
							<!-- eslint-disable svelte/no-navigation-without-resolve -- resolve 済みの /app/bus に、停留所と向きと日の種類を足している -->
							<a
								href={busUrl({ stop: leg.stop.id, direction: data.direction, day })}
								aria-current={leg.day === day ? 'page' : undefined}
							>
								{DAY_LABELS[day]}{day === leg.todayDay ? ' (今日)' : ''}
							</a>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						</li>
					{/each}
				</ul>
			</nav>

			<h2 class="visually-hidden">
				{leg.from.name}から{leg.to.name}への発車
			</h2>
			{#if leg.departures.length === 0}
				<p class="empty">
					{#if leg.checkedAt === null}
						この停留所の時刻表は、まだ取り込めていません。
					{:else}
						この日の、{leg.from.name}から{leg.to.name}へ向かう便は、取り込んだ時刻表にありません。
					{/if}
				</p>
			{:else}
				<ul class="departures" bind:this={list}>
					{#each leg.departures as departure, index (`${departure.time}-${departure.platformNo}-${departure.routes.join()}-${index}`)}
						{@render row(departure, index)}
					{/each}
				</ul>
				{#if isToday && nextIndex === -1}
					<p class="muted">今日の発車は、もうありません。</p>
				{/if}
			{/if}

			{#if leg.notes.length > 0}
				<details class="legend">
					<summary>印の意味</summary>
					<ul>
						{#each leg.notes as note (note)}<li>{note}</li>{/each}
					</ul>
				</details>
			{/if}
		{:else}
			<p>この停留所の時刻表は、取り込んだ時刻表にありません。</p>
		{/if}

		<p class="muted meta">
			函館バスの公式のサービスではありません。ダイヤは、函館バスのサイトで確かめてください。
		</p>
	{/if}
</div>

<style lang="scss">
	@use 'mixins';

	.trip {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0.75rem 0 0.5rem;
	}

	.swap {
		display: inline-grid;
		flex: none;
		place-items: center;
		width: 48px;
		height: 48px;
		border-radius: 50%;
		color: var(--fm-text-muted);

		&:hover {
			background: var(--fm-surface-muted);
		}

		:global(svg) {
			width: 1.5rem;
			height: 1.5rem;
		}
	}

	.cards {
		@include mixins.stack(0.5rem);
		flex: 1;
		min-width: 0;
	}

	.card {
		display: grid;
		grid-template-columns: auto 2.5rem 1fr auto;
		align-items: center;
		gap: 0.5rem;
		min-height: 52px;
		padding: 0 0.75rem;
		border-radius: 0.75rem;
		color: var(--fm-text);
		text-decoration: none;

		:global(.icon) {
			width: 1.25rem;
			height: 1.25rem;
			color: var(--fm-primary);
		}

		:global(.chevron) {
			color: var(--fm-text-muted);
		}

		.card-label {
			color: var(--fm-text-muted);
			font-size: 0.75rem;
		}
	}

	/* 選べる停留所は、浮かせて見せる。未来大は、固定なので平らにする */
	.card.picker {
		border: 1px solid var(--fm-divider);
		background: var(--fm-surface);
		box-shadow: 0 1px 3px rgb(0 0 0 / 12%);
	}

	.card.picker:hover {
		background: var(--fm-surface-muted);
	}

	.card.fixed {
		grid-template-columns: auto 2.5rem 1fr;
	}

	.card-name {
		overflow: hidden;
		font-weight: 700;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.hint {
		margin: 0 0 0.25rem;
		font-size: 0.875rem;
	}

	.locate {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		min-height: 44px;
		padding: 0 0.75rem;
		border: 1px solid var(--fm-divider);
		border-radius: 999px;
		background: var(--fm-surface);
		color: var(--fm-text);
		font: inherit;
		cursor: pointer;
	}

	.stale {
		display: flex;
		gap: 0.5rem;
		margin: 0.5rem 0 0;
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
		background: var(--fm-room-changed-soft);
		color: var(--fm-text);
		font-size: 0.875rem;

		:global(.icon) {
			color: var(--fm-room-changed);
		}
	}

	/* 平日と休日。2 つを同じ幅で並べ、選んでいるほうに下線を引く */
	.days {
		display: grid;
		grid-template-columns: 1fr 1fr;
		margin: 0.5rem 0 0;
		padding: 0;
		border-bottom: 1px solid var(--fm-divider);
		list-style: none;

		a {
			display: flex;
			align-items: center;
			justify-content: center;
			min-height: 48px;
			border-bottom: 3px solid transparent;
			color: var(--fm-text);
			text-decoration: none;
		}

		a[aria-current='page'] {
			border-bottom-color: var(--fm-primary);
			color: var(--fm-primary);
			font-weight: 700;
		}
	}

	.departures {
		position: relative;
		max-height: min(62dvh, 40rem);
		margin: 0;
		padding: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		list-style: none;

		li {
			display: grid;
			grid-template-columns: 1fr auto;
			gap: 0.125rem 0.75rem;
			padding: 0.75rem 0.5rem;
			border-bottom: 1px solid var(--fm-divider);
		}

		li.past {
			opacity: 0.5;
		}

		li.next {
			background: var(--fm-primary-soft);
		}

		.times {
			display: flex;
			align-items: baseline;
			gap: 0.5rem;
			font-size: 1.5rem;
			font-variant-numeric: tabular-nums;
			font-weight: 700;
			grid-column: 1;
		}

		.arrow {
			font-weight: 400;
		}

		.detail {
			grid-column: 1;
			color: var(--fm-text-muted);
			font-size: 0.875rem;
		}

		.routes {
			margin-right: 0.25rem;
		}

		.mark {
			margin-left: 0.25rem;
		}

		.section {
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: 0.375rem;
			grid-column: 1 / -1;

			:global(svg) {
				flex: none;
				width: 1.25rem;
				height: 1.25rem;
				color: var(--fm-primary);
			}
		}

		.platform {
			color: var(--fm-text-muted);
			font-size: 0.75rem;
		}

		.until {
			grid-column: 2;
			grid-row: 1;
			align-self: center;
			color: var(--fm-primary);
			font-size: 0.875rem;
			font-weight: 700;
		}
	}

	.empty {
		margin: 1.5rem 0;
	}

	.legend {
		margin-top: 0.75rem;
		color: var(--fm-text-muted);
		font-size: 0.8125rem;

		summary {
			cursor: pointer;
		}

		ul {
			margin: 0.5rem 0 0;
			padding-left: 1.25rem;
		}
	}

	.meta {
		margin-top: 1.5rem;
		font-size: 0.8125rem;
	}
</style>
