<script lang="ts">
	import { resolve } from '$app/paths';

	let { data }: { data: { unresolvedLessons: number } } = $props();
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
	</ul>
</div>

<style>
	.page {
		max-width: 40rem;
	}
</style>
