<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import IconWarning from '~icons/material-symbols/warning-outline';
	import { formatMinutesUntil } from '#lib/bus-label.ts';
	import type {
		PublicBusPlatform,
		PublicBusStopTimetable,
		PublicNextBusesAtStop,
	} from '@funmary/api';

	type DayType = 'weekday' | 'holiday';

	let {
		data,
	}: {
		data: {
			stops: { id: string; name: string; highlighted: boolean }[];
			checkedAt: string | null;
			stale: boolean;
			selectedStopId: string | null;
			day: DayType;
			todayDay: DayType;
			next: PublicNextBusesAtStop[];
			timetable: PublicBusStopTimetable | null;
		};
	} = $props();

	const DAY_LABELS: Record<DayType, string> = { weekday: '平日', holiday: '土曜・日曜・祝日' };

	// 「あと N 分」が古くならないよう、1 分ごとに読み直す
	$effect(() => {
		const timer = setInterval(() => void invalidateAll(), 60 * 1000);
		return () => clearInterval(timer);
	});

	const busUrl = (params: Record<string, string>) => {
		const query = new URLSearchParams(params).toString();
		return query ? `${resolve('app/bus')}?${query}` : resolve('app/bus');
	};

	/** 表示に使う時刻。24 時以降は、翌日の早朝として 24:10 のまま出す */
	const hourOf = (time: string) => Number(time.slice(0, 2));

	function groupByHour(platform: PublicBusPlatform) {
		const groups: { hour: number; departures: PublicBusPlatform['departures'] }[] = [];
		for (const departure of platform.departures) {
			const hour = hourOf(departure.time);
			const group = groups.find((entry) => entry.hour === hour);
			if (group) group.departures = [...group.departures, departure];
			else groups.push({ hour, departures: [departure] });
		}
		return groups;
	}

	const platformsOfDay = $derived(
		(data.timetable?.platforms ?? []).filter((platform) => platform.day === data.day),
	);
	const selectedStop = $derived(data.stops.find((stop) => stop.id === data.selectedStopId));
	const checkedAtLabel = $derived(
		data.checkedAt
			? new Intl.DateTimeFormat('ja-JP', {
					timeZone: 'Asia/Tokyo',
					month: 'numeric',
					day: 'numeric',
					hour: '2-digit',
					minute: '2-digit',
				}).format(new Date(data.checkedAt))
			: null,
	);
</script>

<svelte:head>
	<title>バス - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#snippet upcoming(entry: PublicNextBusesAtStop)}
	{#if entry.upcoming.length === 0}
		<p class="muted">この先の発車は、取り込んだ時刻表にありません。</p>
	{:else}
		<ul class="departures">
			{#each entry.upcoming as bus (`${bus.serviceDate}-${bus.platformNo}-${bus.time}-${bus.routes.join()}`)}
				<li>
					<span class="time">{bus.time}</span>
					<span class="until">{formatMinutesUntil(bus.minutesUntil)}</span>
					<span class="routes">
						{#each bus.routes as route (route)}<span class="route">{route}</span>{/each}
					</span>
					<span class="destination">{[bus.via, bus.destination].filter(Boolean).join(' → ')}</span>
					{#if bus.platformName}<span class="platform">{bus.platformName}</span>{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

<div class="page page-w-64">
	<h1>バス</h1>
	<p class="muted">
		函館バスが公開している時刻表を、毎日取り込んだものです。函館バスの公式のサービスではないので、ダイヤの変更や運休は、函館バスのサイトで確かめてください。
	</p>

	{#if data.stale}
		<p class="stale" role="status">
			<IconWarning aria-hidden="true" class="icon" />
			<span>時刻表を最後に確かめてから、日がたっています。古いかもしれません。</span>
		</p>
	{/if}

	{#if data.stops.length === 0}
		<p>時刻表は、まだ取り込めていません。しばらくしてからもう一度開いてください。</p>
	{:else}
		<form class="picker" method="GET" action={resolve('app/bus')}>
			<label>
				停留所
				<select name="stop" value={data.selectedStopId ?? ''}>
					<option value="">未来大と亀田支所前</option>
					{#each data.stops as stop (stop.id)}
						<option value={stop.id}>{stop.name}</option>
					{/each}
				</select>
			</label>
			<button type="submit">表示する</button>
		</form>

		{#if !data.selectedStopId}
			{#each data.next as entry (entry.stop.id)}
				<section class="stop">
					<h2>
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve 済みの /app/bus に、停留所を足している -->
						<a href={busUrl({ stop: entry.stop.id })}>{entry.stop.name}</a>
					</h2>
					{@render upcoming(entry)}
				</section>
			{:else}
				<p>強調する停留所の時刻表が、まだありません。上の一覧から停留所を選んでください。</p>
			{/each}
		{:else}
			{#each data.next as entry (entry.stop.id)}
				<section class="stop">
					<h2>{entry.stop.name}の次のバス</h2>
					{@render upcoming(entry)}
				</section>
			{/each}

			<section class="stop">
				<h2>{selectedStop?.name ?? ''}の時刻表</h2>
				{#if data.timetable}
					<nav aria-label="日の種類">
						<ul class="days">
							{#each ['weekday', 'holiday'] as const as day (day)}
								<li>
									<!-- eslint-disable svelte/no-navigation-without-resolve -- resolve 済みの /app/bus に、停留所と日の種類を足している -->
									<a
										href={busUrl({ stop: data.timetable.stop.id, day })}
										aria-current={data.day === day ? 'page' : undefined}
									>
										{DAY_LABELS[day]}{day === data.todayDay ? ' (今日)' : ''}
									</a>
									<!-- eslint-enable svelte/no-navigation-without-resolve -->
								</li>
							{/each}
						</ul>
					</nav>
					{#each platformsOfDay as platform (platform.platformNo)}
						<h3>{platform.platformName ?? `${platform.platformNo} 番のりば`}</h3>
						{#if platform.departures.length === 0}
							<p class="muted">この区分の発車はありません。</p>
						{:else}
							<table class="grid">
								<caption class="visually-hidden">
									{selectedStop?.name ?? ''}、{platform.platformName ?? ''}、{DAY_LABELS[
										data.day
									]}の発車時刻
								</caption>
								<tbody>
									{#each groupByHour(platform) as group (group.hour)}
										<tr>
											<th scope="row">{group.hour}</th>
											<td>
												<ul>
													{#each group.departures as departure (`${departure.time}-${departure.routes.join()}`)}
														<li>
															<span class="minute">{departure.time.slice(3)}</span>
															<span class="route-label"
																>{departure.routes.join('・')}{departure.marks.join('')}</span
															>
														</li>
													{/each}
												</ul>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
							{#if platform.notes.length > 0}
								<ul class="notes">
									{#each platform.notes as note (note)}<li>{note}</li>{/each}
								</ul>
							{/if}
						{/if}
					{:else}
						<p class="muted">この区分の発車表は、取り込んだ時刻表にありません。</p>
					{/each}
				{:else}
					<p>この停留所の発車表は、まだ取り込めていません。</p>
				{/if}
			</section>
			<p><a href={resolve('app/bus')}>未来大と亀田支所前の次のバスに戻る</a></p>
		{/if}

		<p class="muted meta">
			{#if data.timetable}時刻表の版: {data.timetable.generation.name}。{/if}
			{#if checkedAtLabel}最後に確かめた日時: {checkedAtLabel}。{/if}
			{#if data.next[0]?.generation && !data.timetable}時刻表の版: {data.next[0].generation
					.name}。{/if}
		</p>
	{/if}
</div>

<style lang="scss">
	@use 'mixins';

	.picker {
		@include mixins.wrap-row(0.75rem);
		align-items: end;
		margin: 1rem 0;

		label {
			@include mixins.stack(0.25rem);
			font-size: 0.875rem;
		}

		select,
		button {
			min-height: 44px;
			padding: 0 0.75rem;
			border: 1px solid var(--fm-divider);
			border-radius: 0.5rem;
			background: var(--fm-surface);
			color: var(--fm-text);
			font: inherit;
		}

		select {
			min-width: 14rem;
		}

		button {
			cursor: pointer;
		}
	}

	.stale {
		display: flex;
		gap: 0.5rem;
		margin: 1rem 0 0;
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
		background: var(--fm-room-changed-soft);
		color: var(--fm-text);
		font-size: 0.875rem;

		:global(.icon) {
			color: var(--fm-room-changed);
		}
	}

	.stop {
		margin-top: 1.5rem;

		h2 a {
			color: inherit;
			text-decoration-color: var(--fm-divider);
		}
	}

	.departures {
		margin: 0;
		padding: 0;
		list-style: none;

		li {
			display: grid;
			grid-template-columns: 4rem 7.5rem auto 1fr;
			align-items: baseline;
			gap: 0.25rem 0.75rem;
			padding: 0.625rem 0.25rem;
			border-bottom: 1px dashed var(--fm-divider);
		}

		.time {
			font-size: 1.25rem;
			font-variant-numeric: tabular-nums;
			font-weight: 700;
		}

		.until {
			color: var(--fm-text-muted);
			font-size: 0.875rem;
		}

		.platform {
			grid-column: 2 / -1;
			color: var(--fm-text-muted);
			font-size: 0.75rem;
		}
	}

	.routes {
		display: inline-flex;
		gap: 0.25rem;
	}

	.route {
		padding: 0 0.5rem;
		border-radius: 999px;
		background: var(--fm-primary-soft);
		color: var(--fm-primary);
		font-size: 0.8125rem;
		font-weight: 700;
	}

	@media (max-width: 40rem) {
		.departures li {
			grid-template-columns: 3.75rem 1fr;

			.routes,
			.destination {
				grid-column: 2;
			}
		}
	}

	.days {
		@include mixins.wrap-row(0.5rem);
		margin: 0.75rem 0;
		padding: 0;
		list-style: none;

		a {
			display: inline-flex;
			align-items: center;
			min-height: 40px;
			padding: 0 0.875rem;
			border: 1px solid var(--fm-divider);
			border-radius: 999px;
			color: var(--fm-text);
			font-size: 0.875rem;
			text-decoration: none;
		}

		a[aria-current='page'] {
			border-color: var(--fm-primary);
			background: var(--fm-primary-soft);
			color: var(--fm-primary);
			font-weight: 700;
		}
	}

	.grid {
		width: 100%;
		border-collapse: collapse;

		th {
			width: 2.5rem;
			padding: 0.5rem 0.25rem;
			font-variant-numeric: tabular-nums;
			text-align: right;
			vertical-align: top;
		}

		td {
			padding: 0.5rem 0.25rem 0.5rem 0.75rem;
		}

		tr {
			border-bottom: 1px dashed var(--fm-divider);
		}

		ul {
			@include mixins.wrap-row(0.25rem 1rem);
			margin: 0;
			padding: 0;
			list-style: none;
		}

		.minute {
			font-variant-numeric: tabular-nums;
			font-weight: 700;
		}

		.route-label {
			margin-left: 0.25rem;
			color: var(--fm-text-muted);
			font-size: 0.75rem;
		}
	}

	.notes {
		margin: 0.75rem 0 0;
		padding-left: 1.25rem;
		color: var(--fm-text-muted);
		font-size: 0.8125rem;
	}

	.meta {
		margin-top: 1.5rem;
		font-size: 0.8125rem;
	}
</style>
