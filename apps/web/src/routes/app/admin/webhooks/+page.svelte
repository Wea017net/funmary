<script lang="ts">
	import Button, { Label } from '@smui/button';
	import { enhance } from '$app/forms';
	import SettingsBreadcrumb from '$lib/components/SettingsBreadcrumb.svelte';

	let {
		data,
		form,
	}: {
		data: { limit: number; max: number };
		form: { error?: string; message?: string } | null;
	} = $props();
</script>

<svelte:head>
	<title>Webhook の上限 - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<SettingsBreadcrumb current="Webhook の上限" />
	<h1>Webhook の上限</h1>
	<p>
		利用者が通知の送り先に登録できる Webhook の個数です。0
		にすると、新しく登録できなくなります。上限を下げても、登録済みの Webhook
		は消えません。上限を超えている間は、編集、無効化、削除だけができます。
	</p>

	{#if form?.error}
		<p class="error" role="alert">{form.error}</p>
	{:else if form?.message}
		<p class="message" role="status">{form.message}</p>
	{/if}

	<form
		method="POST"
		action="?/save"
		use:enhance={() =>
			({ update }) =>
				update({ reset: false })}
	>
		<label class="field">
			1 人あたりの上限 (0 から {data.max})
			<input
				type="number"
				name="limit"
				min="0"
				max={data.max}
				step="1"
				value={data.limit}
				required
			/>
		</label>
		<Button type="submit" variant="unelevated"><Label>保存する</Label></Button>
	</form>
</div>

<style>
	.page {
		max-width: 40rem;
	}

	form {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.field input {
		min-height: 44px;
		width: 8rem;
		padding: 0 0.75rem;
		box-sizing: border-box;
		font: inherit;
	}

	.message,
	.error {
		padding: 0.75rem 1rem;
		border: 1px solid currentcolor;
		border-radius: 0.25rem;
	}

	.error {
		color: var(--fm-error);
	}
</style>
