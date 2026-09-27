<script lang="ts">
	import { resolve } from '$app/paths';
	import LessonRoom from '$lib/components/LessonRoom.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import type { LessonView } from '$lib/server/lesson-view.ts';
	import type { DayNote } from '$lib/server/user-timetable.ts';
	import { formatDate, formatDayNote, formatFetchedAt } from '$lib/timetable-label.ts';

	interface TodayView {
		date: string;
		note: DayNote | null;
		lessons: LessonView[];
		next: (LessonView & { inProgress: boolean }) | null;
		hasRegistrations: boolean;
		usesEstimatedTerms: boolean;
		fetchedAt: { date: string; time: string } | null;
		stale: boolean;
	}

	let {
		data,
	}: {
		data: { user: { email: string; isAdmin: boolean } | null; today: TodayView | null };
	} = $props();
</script>

<svelte:head>
	<title>Funmary</title>
	<meta
		name="description"
		content="公立はこだて未来大学の学生向けの便利な総合 Web アプリ (非公式)"
	/>
</svelte:head>

<main>
	<h1>Funmary</h1>

	{#if data.user && data.today}
		{@const today = data.today}
		<section aria-labelledby="next-heading" class="next">
			<h2 id="next-heading">{today.next?.inProgress ? '授業中' : '次の授業'}</h2>
			{#if today.next}
				{@const next = today.next}
				<p class="next-time">
					{#if next.date !== today.date}{formatDate(next.date)}{/if}
					{#if next.start && next.end}{next.start}-{next.end}{/if}
					<span class="period">{next.period} 限</span>
				</p>
				<p class="next-room"><LessonRoom room={next.room} tentative={next.roomIsTentative} /></p>
				<p>
					<a href={resolve('/subjects/[id]', { id: String(next.subjectId) })}>{next.subjectName}</a>
					<StatusBadge status={next.status} />
				</p>
			{:else if today.hasRegistrations}
				<p>この先 2 週間に授業はありません。</p>
			{:else}
				<p>履修科目がまだ登録されていません。</p>
				<p><a href={resolve('/courses')}>履修科目を登録する</a></p>
			{/if}
		</section>

		<section aria-labelledby="today-heading">
			<h2 id="today-heading">今日の授業 {formatDate(today.date)}</h2>
			{#if today.note}
				<p class="note">{formatDayNote(today.note)}</p>
			{/if}
			{#if today.lessons.length > 0}
				<ul class="lessons">
					{#each today.lessons as lesson (lesson.key)}
						<li class={{ cancelled: lesson.status === 'cancelled' }}>
							<span class="when">{lesson.period} 限 {lesson.start ?? ''}</span>
							<a href={resolve('/subjects/[id]', { id: String(lesson.subjectId) })}
								>{lesson.subjectName}</a
							>
							<StatusBadge status={lesson.status} />
							<span class="room"
								><LessonRoom room={lesson.room} tentative={lesson.roomIsTentative} /></span
							>
						</li>
					{/each}
				</ul>
			{:else}
				<p>今日の授業はありません。</p>
			{/if}
		</section>

		<p class={['freshness', { stale: today.stale }]} role={today.stale ? 'alert' : undefined}>
			{#if today.fetchedAt}
				休講情報の最終取得: {formatFetchedAt(today.fetchedAt, today.date)}
				{#if today.stale}
					<br />12 時間以上更新されていません。休講などが載っていない可能性があります。
				{/if}
			{:else}
				休講情報をまだ取得していません。休講などは載っていません。
			{/if}
		</p>
		{#if today.usesEstimatedTerms}
			<p class="note">
				学期の期間は、大学の学年暦がまだ入っていないため、推定した日付で出しています。
			</p>
		{/if}

		<nav aria-label="ページ">
			<ul>
				<li><a href={resolve('/week')}>週の時間割</a></li>
				<li><a href={resolve('/courses')}>履修科目</a></li>
				{#if data.user.isAdmin}
					<li><a href={resolve('/admin')}>管理</a></li>
				{/if}
			</ul>
		</nav>
		<p>{data.user.email} でログインしています。</p>
		<!-- /auth は、サーバーが処理する。SvelteKit の form の処理を通さず、通常の送信にする -->
		<form method="POST" action="/auth/logout" data-sveltekit-reload>
			<button type="submit">ログアウト</button>
		</form>
	{:else}
		<p>公立はこだて未来大学の学生向けの便利な総合 Web アプリです。</p>
		<p><a href={resolve('/login')}>ログイン</a></p>
	{/if}

	<footer>
		<p>Funmary は公立はこだて未来大学の公式のアプリではありません。</p>
	</footer>
</main>

<style>
	main {
		max-width: 40rem;
		margin: 0 auto;
		padding: 1rem;
		font-family: system-ui, sans-serif;
		line-height: 1.7;
	}
	.next {
		padding: 1rem;
		border-radius: 0.5rem;
		background: #f9e9ea;
	}
	.next h2 {
		margin-top: 0;
		font-size: 1rem;
		color: #9d2126;
	}
	.next-time {
		margin: 0;
		font-size: 1.75rem;
		font-weight: bold;
	}
	.next-room {
		margin: 0;
		font-size: 1.5rem;
	}
	.period {
		font-size: 1rem;
		font-weight: normal;
	}
	.lessons {
		padding: 0;
		list-style: none;
	}
	.lessons li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 0.5rem;
		padding: 0.5rem 0;
		border-bottom: 1px solid #dddddd;
	}
	.cancelled a {
		text-decoration: line-through;
	}
	.when {
		min-width: 6.5rem;
		font-variant-numeric: tabular-nums;
	}
	.note,
	.freshness {
		color: #666666;
		font-size: 0.875rem;
	}
	.stale {
		padding: 0.5rem;
		border-left: 4px solid #8a6d00;
		background: #fdf6d3;
		color: #333333;
	}
</style>
