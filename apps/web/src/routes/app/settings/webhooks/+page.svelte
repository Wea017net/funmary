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
			limit: number;
			count: number;
			kindOptions: readonly { kind: string; label: string }[];
			webhooks: readonly {
				id: number;
				label: string | null;
				maskedUrl: string;
				kinds: readonly string[];
				enabled: boolean;
				disabledReason: string | null;
			}[];
		};
		form: { error?: string; message?: string } | null;
	} = $props();

	const canAdd = $derived(data.count < data.limit);
</script>

<svelte:head>
	<title>Discord の Webhook - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<SettingsBreadcrumb current="Discord の Webhook" />
	<h1>Discord の Webhook</h1>
	<p>
		休講、補講、教室変更などを、自分の Discord
		サーバーのチャンネルに届けます。友人と共有するサーバーと、自分用の
		サーバーで、届ける通知の種類を分けることもできます。登録できるのは、{data.limit} 個までです (いま
		{data.count}
		個)。
	</p>

	{#if form?.error}
		<p class="error" role="alert">{form.error}</p>
	{:else if form?.message}
		<p class="message" role="status">{form.message}</p>
	{/if}

	{#if data.webhooks.length > 0}
		<ul class="webhooks">
			{#each data.webhooks as webhook (webhook.id)}
				<li class="webhook">
					<h2>
						{webhook.label ?? '名前なし'}
						{#if !webhook.enabled}<span class="badge">無効</span>{/if}
					</h2>
					<p class="meta">{webhook.maskedUrl}</p>
					{#if !webhook.enabled && webhook.disabledReason}
						<p class="error" role="status">
							止めました: {webhook.disabledReason}。直したら、有効に戻してください。
						</p>
					{/if}
					<form
						method="POST"
						action="?/update"
						use:enhance={() =>
							({ update }) =>
								update({ reset: false })}
						class="stack"
					>
						<input type="hidden" name="id" value={webhook.id} />
						<label class="field">
							名前 (任意)
							<input type="text" name="label" value={webhook.label ?? ''} maxlength="40" />
						</label>
						<fieldset>
							<legend>届ける通知</legend>
							{#each data.kindOptions as option (option.kind)}
								<label class="check">
									<input
										type="checkbox"
										name="kinds"
										value={option.kind}
										checked={webhook.kinds.includes(option.kind)}
									/>
									{option.label}
								</label>
							{/each}
						</fieldset>
						<Button type="submit" variant="outlined"><Label>保存する</Label></Button>
					</form>
					<div class="actions">
						<form method="POST" action="?/test" use:enhance>
							<input type="hidden" name="id" value={webhook.id} />
							<Button type="submit" variant="outlined" disabled={!webhook.enabled}>
								<Label>テスト通知を送る</Label>
							</Button>
						</form>
						<form method="POST" action="?/toggle" use:enhance>
							<input type="hidden" name="id" value={webhook.id} />
							<Button type="submit" variant="outlined">
								<Label>{webhook.enabled ? '無効にする' : '有効に戻す'}</Label>
							</Button>
						</form>
						<form
							method="POST"
							action="?/remove"
							use:enhance
							use:confirmSubmit={'この Webhook を削除します。よろしいですか?'}
						>
							<input type="hidden" name="id" value={webhook.id} />
							<Button type="submit" variant="outlined"><Label>削除する</Label></Button>
						</form>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	<section aria-labelledby="add-heading">
		<h2 id="add-heading">Webhook を登録する</h2>
		{#if canAdd}
			<ol class="steps">
				<li>
					Discord
					で、通知を受け取るチャンネルの設定を開き、「連携サービス」の「ウェブフック」から、新しい
					ウェブフックを作ります。
				</li>
				<li>「ウェブフック URL をコピー」を押して、下の欄に貼り付けます。</li>
				<li>登録すると、テスト通知が届きます。届いたことを確かめてください。</li>
			</ol>
			<form method="POST" action="?/add" use:enhance class="stack">
				<label class="field">
					Webhook の URL
					<input
						type="url"
						name="url"
						required
						autocomplete="off"
						spellcheck="false"
						placeholder="https://discord.com/api/webhooks/..."
					/>
				</label>
				<label class="field">
					名前 (任意)
					<input type="text" name="label" maxlength="40" placeholder="例: 友人と共有のサーバー" />
				</label>
				<fieldset>
					<legend>届ける通知</legend>
					{#each data.kindOptions as option (option.kind)}
						<label class="check">
							<input type="checkbox" name="kinds" value={option.kind} checked />
							{option.label}
						</label>
					{/each}
				</fieldset>
				<Button type="submit" variant="unelevated"><Label>登録して、テスト通知を送る</Label></Button
				>
			</form>
		{:else}
			<p>
				登録できる Webhook は {data.limit} 個までで、上限に達しています。新しく登録するには、使わないものを削除
				してください。
			</p>
		{/if}
	</section>
	<p class="meta">
		Webhook の URL は、暗号化して保存します。URL
		を知っている人は、そのチャンネルに投稿できるので、他の人に 見せないでください。
	</p>
</div>

<style>
	.page {
		max-width: 40rem;
	}

	h2 {
		margin-top: 2rem;
		font-size: 1.125rem;
	}

	.webhooks {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		margin: 1.5rem 0 0;
		padding: 0;
		list-style: none;
	}

	.webhook {
		padding: 1rem;
		border: 1px solid var(--fm-divider);
		border-radius: 0.5rem;
	}

	.webhook h2 {
		margin-top: 0;
	}

	.badge {
		margin-left: 0.5rem;
		padding: 0.125rem 0.5rem;
		border: 1px solid currentcolor;
		border-radius: 0.25rem;
		font-size: 0.75rem;
		font-weight: normal;
	}

	.meta {
		color: var(--fm-text-muted);
		font-size: 0.875rem;
		overflow-wrap: anywhere;
	}

	.stack {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		width: 100%;
	}

	.field input {
		min-height: 44px;
		padding: 0 0.75rem;
		box-sizing: border-box;
		font: inherit;
	}

	fieldset {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0;
		padding: 0.75rem 1rem;
		border: 1px solid var(--fm-divider);
		border-radius: 0.5rem;
	}

	.check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 44px;
	}

	.steps {
		padding-left: 1.5rem;
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
