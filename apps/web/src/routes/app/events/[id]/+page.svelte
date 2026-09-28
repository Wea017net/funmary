<script lang="ts">
	import Button, { Label } from '@smui/button';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import EventForm from '$lib/components/EventForm.svelte';
	import type { EventFormValues } from '$lib/event-form.ts';

	let {
		data,
		form,
	}: {
		data: {
			values: EventFormValues;
			candidates: { date: string; label: string }[];
			keptExclusions: string[];
		};
		form: { error?: string; values?: EventFormValues } | null;
	} = $props();
</script>

<svelte:head>
	<title>予定を直す - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<p><a href={resolve('/app/events')}>自分の予定</a></p>
	<h1>予定を直す</h1>
	<EventForm
		values={form?.values ?? data.values}
		error={form?.error}
		submitLabel="保存する"
		action="?/save"
		candidates={data.candidates}
		keptExclusions={data.keptExclusions}
	/>

	<section class="danger" aria-labelledby="delete-heading">
		<h2 id="delete-heading">予定を消す</h2>
		<p>消した予定は、元に戻せません。繰り返しの予定は、すべての回が消えます。</p>
		<form method="POST" action="?/delete" use:enhance>
			<Button type="submit" variant="outlined"><Label>この予定を消す</Label></Button>
		</form>
	</section>
</div>

<style>
	.page {
		max-width: 44rem;
	}
	.danger {
		margin-top: 2rem;
	}
	h2 {
		font-size: 1.1rem;
	}
</style>
