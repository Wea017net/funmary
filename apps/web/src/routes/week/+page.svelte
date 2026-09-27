<script lang="ts">
	import { resolve } from '$app/paths';
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
</script>

<svelte:head>
	<title>週の時間割 - Funmary</title>
</svelte:head>

<main>
	<p><a href={resolve('/')}>今日</a></p>
	<h1>{formatDate(data.monday)} からの週</h1>

	<nav aria-label="週の切り替え" class="weeks">
		<!-- eslint-disable svelte/no-navigation-without-resolve -- resolve した /week に、週の日付を足している -->
		<a href={weekUrl(data.previous)}>前の週</a>
		{#if !data.isThisWeek}
			<a href={resolve('/week')}>今週</a>
		{/if}
		<a href={weekUrl(data.next)}>次の週</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</nav>

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
						<th scope="col" class={{ today: day.date === data.today }}>
							{formatDate(day.date)}
							{#if day.note}
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
							<td class={{ today: cell.date === data.today }}>
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
</main>

<style>
	main {
		max-width: 72rem;
		margin: 0 auto;
		padding: 1rem;
		font-family: system-ui, sans-serif;
		line-height: 1.6;
	}
	.weeks {
		display: flex;
		gap: 1.5rem;
	}
	.weeks a {
		display: inline-block;
		min-height: 48px;
		line-height: 48px;
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
		border: 1px solid #dddddd;
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
		background: #ffffff;
		white-space: nowrap;
	}
	thead th:first-child {
		width: 4.5rem;
	}
	.today {
		background: #f9e9ea;
	}
	.time,
	.note {
		display: block;
		color: #666666;
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
