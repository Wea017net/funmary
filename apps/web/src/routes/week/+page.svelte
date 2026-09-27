<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import IconCalendar from '~icons/material-symbols/calendar-month-outline';
	import IconHoliday from '~icons/material-symbols/event-busy-outline';
	import IconNext from '~icons/material-symbols/chevron-right';
	import IconPrevious from '~icons/material-symbols/chevron-left';
	import IconSubstitute from '~icons/material-symbols/swap-horiz';
	import LessonRoom from '$lib/components/LessonRoom.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import type { LessonView } from '$lib/server/lesson-view.ts';
	import type { DayNote } from '$lib/server/user-timetable.ts';
	import { formatDate, formatDayNote } from '$lib/timetable-label.ts';

	interface Row {
		period: number;
		start: string | null;
		end: string | null;
		cells: { date: string; lessons: LessonView[] }[];
	}

	let {
		data,
	}: {
		data: {
			monday: string;
			previous: string;
			next: string;
			isThisWeek: boolean;
			today: string;
			days: { date: string; note: DayNote | null }[];
			rows: Row[];
			hasLessons: boolean;
			usesEstimatedTerms: boolean;
		};
	} = $props();

	const weekUrl = (date: string) => `${resolve('/week')}?date=${date}`;

	let picker: HTMLInputElement | undefined = $state();

	/** カレンダーのボタン。ブラウザの日付の選択を開く (開けないブラウザでは、入力欄に移る) */
	function openPicker() {
		if (!picker) return;
		try {
			picker.showPicker();
		} catch {
			// 古いブラウザなどで開けないときは、入力欄に移って、キーボードで入れられるようにする
			picker.focus();
		}
	}

	/** 日付を選んだら、その日を含む週に移る */
	async function pickDate(event: Event & { currentTarget: HTMLInputElement }) {
		const date = event.currentTarget.value;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve した /week に、選んだ日付を足している
		if (date) await goto(weekUrl(date));
	}

	/** 日付の横に出すラベル。祝日と全学の休講日は授業がないので、列も灰色にする */
	const NOTE_BADGES = {
		holiday: { label: '祝日', icon: IconHoliday },
		noClass: { label: '休講日', icon: IconHoliday },
		substitute: { label: '振替', icon: IconSubstitute },
	} as const;

	const isDayOff = (note: DayNote | null) => note?.kind === 'holiday' || note?.kind === 'noClass';
	const offDates = $derived(
		new Set(data.days.filter((day) => isDayOff(day.note)).map((day) => day.date)),
	);
</script>

<svelte:head>
	<title>週の時間割 - Funmary</title>
</svelte:head>

<div class="page">
	<h1>{formatDate(data.monday)} からの週</h1>

	<div class="toolbar">
		<nav aria-label="週の切り替え" class="weeks">
			<!-- eslint-disable svelte/no-navigation-without-resolve -- resolve した /week に、週の日付を足している -->
			<a class="icon-button" href={weekUrl(data.previous)} aria-label="前の週" title="前の週">
				<IconPrevious aria-hidden="true" />
			</a>
			<!-- 今週を見ているときも同じ場所に置き、ほかのボタンの位置を変えない -->
			{#if data.isThisWeek}
				<span class="text-button current" aria-current="date">今週</span>
			{:else}
				<a class="text-button" href={resolve('/week')}>今週</a>
			{/if}
			<a class="icon-button" href={weekUrl(data.next)} aria-label="次の週" title="次の週">
				<IconNext aria-hidden="true" />
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</nav>
		<div class="picker">
			<button
				type="button"
				class="icon-button"
				aria-label="カレンダーで日付を選んで、その週を出す"
				title="カレンダーで選ぶ"
				onclick={openPicker}
			>
				<IconCalendar aria-hidden="true" />
			</button>
			<!-- 日付の選択はボタンから開く。入力欄そのものは見せず、Tab でも止まらない -->
			<input
				bind:this={picker}
				type="date"
				value={data.monday}
				onchange={pickDate}
				tabindex="-1"
				aria-hidden="true"
			/>
		</div>
	</div>

	{#if !data.hasLessons}
		<p>この週に授業はありません。</p>
	{/if}

	<div class="scroll">
		<table>
			<caption class="visually-hidden">{formatDate(data.monday)} からの週の時間割</caption>
			<thead>
				<tr>
					<th scope="col"><span class="visually-hidden">時限</span></th>
					{#each data.days as day (day.date)}
						<th scope="col" class={{ today: day.date === data.today, off: isDayOff(day.note) }}>
							<span class="date">{formatDate(day.date)}</span>
							{#if day.note}
								{@const badge = NOTE_BADGES[day.note.kind]}
								<span class={['day-badge', day.note.kind]}>
									<badge.icon aria-hidden="true" />{badge.label}
								</span>
								<span class="note">{formatDayNote(day.note)}</span>
							{/if}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each data.rows as row (row.period)}
					<tr>
						<th scope="row">
							{row.period} 限
							{#if row.start && row.end}
								<span class="time">{row.start}-{row.end}</span>
							{/if}
						</th>
						{#each row.cells as cell (cell.date)}
							<td class={{ today: cell.date === data.today, off: offDates.has(cell.date) }}>
								{#each cell.lessons as lesson (lesson.key)}
									<div class={['lesson', { cancelled: lesson.status === 'cancelled' }]}>
										<a href={resolve('/subjects/[id]', { id: String(lesson.subjectId) })}
											>{lesson.subjectName}</a
										>
										<StatusBadge status={lesson.status} />
										<span class="room">
											<LessonRoom room={lesson.room} tentative={lesson.roomIsTentative} />
										</span>
									</div>
								{/each}
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if data.usesEstimatedTerms}
		<p class="note">
			学期の期間は、大学の学年暦がまだ入っていないため、推定した日付で出しています。
		</p>
	{/if}
</div>

<style>
	.page {
		max-width: 72rem;
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.weeks {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
	.icon-button,
	.text-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 48px;
		height: 48px;
		box-sizing: border-box;
		border: 1px solid var(--fm-divider);
		border-radius: 0.5rem;
		background: var(--fm-surface);
		color: var(--fm-text);
		font: inherit;
		text-decoration: none;
		cursor: pointer;
		transition: background-color 150ms ease-out;
	}
	.icon-button:hover,
	.text-button:hover {
		background: var(--fm-surface-muted);
	}
	.icon-button :global(svg) {
		width: 1.5rem;
		height: 1.5rem;
	}
	.text-button {
		padding: 0 1rem;
	}
	.text-button.current {
		color: var(--fm-text-muted);
		cursor: default;
	}
	.text-button.current:hover {
		background: var(--fm-surface);
	}
	.picker {
		position: relative;
	}
	/* 日付の選択が、カレンダーのボタンの下に開くよう、入力欄をボタンの下に重ねて隠す */
	.picker input {
		position: absolute;
		left: 0;
		bottom: 0;
		width: 1px;
		height: 1px;
		min-height: 0;
		padding: 0;
		border: 0;
		opacity: 0;
		pointer-events: none;
	}
	/* スマホでは、表を横に送って 1 日ずつ見る (設計書 12.4) */
	.scroll {
		overflow-x: auto;
		scroll-snap-type: x mandatory;
	}
	table {
		border-collapse: collapse;
	}
	th,
	td {
		padding: 0.5rem;
		border: 1px solid var(--fm-divider);
		vertical-align: top;
		text-align: left;
	}
	thead th:not(:first-child),
	td {
		min-width: calc(100vw - 9rem);
		scroll-snap-align: end;
	}
	tbody th {
		width: 4.5rem;
		position: sticky;
		left: 0;
		background: var(--fm-background);
		white-space: nowrap;
	}
	thead th:first-child {
		width: 4.5rem;
	}
	.today {
		background: var(--fm-primary-soft);
	}
	/* 祝日と全学の休講日は授業がないので、列を灰色にする */
	.off {
		background: var(--fm-surface-muted);
	}
	.date {
		display: block;
	}
	.day-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.125rem;
		margin-top: 0.25rem;
		padding: 0 0.375rem 0 0.25rem;
		border: 1px solid currentColor;
		border-radius: 0.375rem;
		color: var(--fm-primary);
		font-size: 0.75rem;
		font-weight: 700;
		line-height: 1.6;
	}
	.day-badge :global(svg) {
		width: 0.875rem;
		height: 0.875rem;
	}
	.day-badge.substitute {
		color: var(--fm-link);
	}
	.time,
	.note {
		display: block;
		color: var(--fm-text-muted);
		font-size: 0.75rem;
		font-weight: normal;
	}
	.lesson + .lesson {
		margin-top: 0.5rem;
	}
	.lesson a {
		display: block;
	}
	.cancelled a {
		text-decoration: line-through;
	}
	.room {
		display: block;
		font-size: 0.875rem;
	}
	@media (min-width: 840px) {
		.scroll {
			scroll-snap-type: none;
		}
		table {
			width: 100%;
			table-layout: fixed;
		}
		thead th:not(:first-child),
		td {
			min-width: 0;
		}
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
