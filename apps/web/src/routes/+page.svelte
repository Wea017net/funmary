<script lang="ts">
	import Landing from '$lib/components/Landing.svelte';

	let { data }: { data: { signedIn: boolean; registration: 'invite' | 'open' | 'closed' } } =
		$props();
</script>

<svelte:head>
	<title>Funmary</title>
	<meta
		name="description"
		content="公立はこだて未来大学の学生向けの便利な総合 Web アプリ (非公式)"
	/>
</svelte:head>

<Landing registration={data.registration} signedIn={data.signedIn} />
