<script lang="ts">
	import { resolve } from '$app/paths';

	let { data }: { data: { unresolvedLessons: number } } = $props();
</script>

<svelte:head>
	<title>管理 - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main>
	<h1>管理</h1>
	<ul>
		<li>
			<a href={resolve('/admin/lessons')}>照合できなかった授業名</a>
			({data.unresolvedLessons} 件)
		</li>
	</ul>
</main>

<style>
	main {
		max-width: 40rem;
		margin: 0 auto;
		padding: 1rem;
		font-family: system-ui, sans-serif;
		line-height: 1.7;
	}
</style>
