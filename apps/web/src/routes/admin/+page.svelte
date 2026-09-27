<script lang="ts">
	import { resolve } from '$app/paths';

	let {
		data,
	}: { data: { unresolvedLessons: number; calendarYear: number; estimatedTerms: number } } =
		$props();
</script>

<svelte:head>
	<title>管理 - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<h1>管理</h1>
	<ul>
		<li>
			<a href={resolve('/admin/lessons')}>照合できなかった授業名</a>
			({data.unresolvedLessons} 件)
		</li>
		<li>
			<a href={resolve('/admin/calendar')}>学年暦</a>
			{#if data.estimatedTerms > 0}
				({data.calendarYear} 年度の前期と後期のうち {data.estimatedTerms} つが推定のままです)
			{:else}
				({data.calendarYear} 年度は入力済み)
			{/if}
		</li>
	</ul>
</div>

<style>
	.page {
		max-width: 40rem;
	}
</style>
