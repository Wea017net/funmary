<script lang="ts">
	import Button, { Label } from '@smui/button';
	import { enhance } from '$app/forms';
	import { confirmSubmit } from '$lib/actions/confirm-submit.ts';
	import SettingsBreadcrumb from '$lib/components/SettingsBreadcrumb.svelte';

	let {
		data,
		form,
	}: {
		data: {
			configured: boolean;
			enabled: boolean;
			linked: { destination: 'thread' | 'dm' } | null;
			callback: { ok: boolean; message: string } | null;
		};
		form: { error?: string; message?: string } | null;
	} = $props();

	let destination = $state<'thread' | 'dm'>('thread');
</script>

<svelte:head>
	<title>Discord連携 - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<SettingsBreadcrumb current="Discord連携" />
	<h1>Discord連携</h1>

	{#if data.callback}
		<p class={data.callback.ok ? 'message' : 'error'} role={data.callback.ok ? 'status' : 'alert'}>
			{data.callback.message}
		</p>
	{/if}
	{#if form?.error}
		<p class="error" role="alert">{form.error}</p>
	{:else if form?.message}
		<p class="message" role="status">{form.message}</p>
	{/if}

	{#if !data.configured}
		<p>いまは Discord 連携を使えません。</p>
	{:else if !data.enabled}
		<p>いまは、管理者が Discord 連携を無効にしています。</p>
	{:else if data.linked}
		<p>
			Discord と連携しています。通知の送り先は、{data.linked.destination === 'thread'
				? 'サポートサーバーの、あなただけの非公開スレッド'
				: 'あなたへの DM'} です。
		</p>
		<p class="meta">
			別の Discord アカウントに付け替えたいときは、いったん解除してから、もう一度連携してください。
		</p>
		<form
			method="POST"
			action="?/unlink"
			use:enhance
			use:confirmSubmit={'Discord との連携を解除します。よろしいですか?'}
		>
			<Button type="submit" variant="outlined"><Label>連携を解除する</Label></Button>
		</form>
	{:else}
		<p>
			Discord のアカウントを紐付け、休講などの通知を、Funmary
			のサポートサーバーの非公開スレッドか、DM で受け取れるようにします。
		</p>
		<form method="POST" action="?/link" use:enhance class="link-form">
			<fieldset>
				<legend>通知の送り先</legend>
				<label>
					<input type="radio" name="destination" value="thread" bind:group={destination} />
					サポートサーバーの、あなただけの非公開スレッド
				</label>
				<label>
					<input type="radio" name="destination" value="dm" bind:group={destination} />
					あなたへの DM (サーバーのメンバーからの DM を許可している必要があります)
				</label>
			</fieldset>
			<Button type="submit" variant="unelevated"><Label>Discord と連携する</Label></Button>
		</form>
	{/if}
</div>

<style>
	.page {
		max-width: 40rem;
	}

	.meta {
		color: var(--fm-text-muted);
		font-size: 0.875rem;
	}

	.link-form {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1rem;
	}

	fieldset {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0.75rem 1rem;
		border: 1px solid var(--fm-divider);
		border-radius: 0.5rem;
	}

	label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 44px;
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
