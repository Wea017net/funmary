<script lang="ts">
	import { resolve } from '$app/paths';
	import EventForm from '#lib/components/EventForm.svelte';
	import type { EventFormValues } from '#lib/event-form.ts';

	let {
		data,
		form,
	}: {
		data: { values: EventFormValues };
		form: { error?: string; values?: EventFormValues } | null;
	} = $props();
</script>

<svelte:head>
	<title>予定を足す - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<p><a href={resolve('app/events')}>自分の予定</a></p>
	<h1>予定を足す</h1>
	<EventForm values={form?.values ?? data.values} error={form?.error} submitLabel="足す" />
</div>
