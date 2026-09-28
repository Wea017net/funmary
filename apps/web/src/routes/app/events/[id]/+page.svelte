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
			shareUrl: string | null;
		};
		form: { error?: string; message?: string; values?: EventFormValues } | null;
	} = $props();
</script>

<svelte:head>
	<title>予定を直す - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<p><a href={resolve('/app/events')}>自分の予定</a></p>
	<h1>予定を直す</h1>
	{#if form?.message}
		<p class="message" role="status">{form.message}</p>
	{/if}
	<EventForm
		values={form?.values ?? data.values}
		error={form?.error}
		submitLabel="保存する"
		action="?/save"
		candidates={data.candidates}
		keptExclusions={data.keptExclusions}
	/>

	{#if data.shareUrl}
		<section class="share" aria-labelledby="share-heading">
			<h2 id="share-heading">共有のリンク</h2>
			<p>
				このリンクを知っている、Funmary
				にログインした人が、この予定を見て、自分の時間割に加えられます。リンクを作り直すと、前のリンクは使えなくなります。公開範囲を変えても、使えなくなります。
			</p>
			<label class="field">
				リンク
				<input readonly value={data.shareUrl} onfocus={(event) => event.currentTarget.select()} />
			</label>
			<form method="POST" action="?/rotate" use:enhance>
				<Button type="submit" variant="outlined"><Label>リンクを作り直す</Label></Button>
			</form>
		</section>
	{/if}

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
	.share,
	.danger {
		margin-top: 2rem;
	}
	h2 {
		font-size: 1.1rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 0.75rem;
		font-size: 0.875rem;
	}
	.message {
		padding: 0.75rem 1rem;
		border: 1px solid currentcolor;
		border-radius: 0.25rem;
	}
</style>
