<script lang="ts">
	import Button, { Label } from '@smui/button';
	import { enhance } from '$app/forms';
	import { confirmSubmit } from '$lib/actions/confirm-submit.ts';
	import { createCopyState } from '$lib/clipboard.svelte.ts';
	import SettingsBreadcrumb from '$lib/components/SettingsBreadcrumb.svelte';

	let {
		data,
		form,
	}: {
		data: {
			subscription: { createdAt: string; lastUsedAt: string | null } | null;
			/** フィードに載せる通知の種類。発行していなければ null */
			kinds: string[] | null;
			kindOptions: readonly { kind: string; label: string }[];
		};
		form: {
			error?: string;
			message?: string;
			issued?: { rss: string; atom: string; json: string };
		} | null;
	} = $props();

	const copyState = createCopyState();
	let urlField: HTMLInputElement | undefined = $state();

	async function copyUrl(url: string) {
		const ok = await copyState.copy(url);
		// コピーできないときは、欄を選んで、手でコピーしてもらう
		if (!ok) urlField?.select();
	}
</script>

<svelte:head>
	<title>お知らせのフィード - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<SettingsBreadcrumb current="お知らせのフィード" />
	<h1>お知らせのフィード</h1>
	<p>
		休講、補講、教室変更などの通知を、RSS リーダーで受け取れます。Funmary から送る仕組みではなく RSS
		リーダーが取りに来る仕組みなので、Discord や Webhook が不調なときの受け皿にもなります。
	</p>
	<p class="muted">載るのは直近 30 日、最大 50 件です。授業前のリマインダーは載りません。</p>

	{#if form?.error}
		<p class="error" role="alert">{form.error}</p>
	{:else if form?.message}
		<p class="message" role="status">{form.message}</p>
	{/if}

	{#if form?.issued}
		{@const issued = form.issued}
		<section class="issued" aria-labelledby="issued-heading">
			<h2 id="issued-heading">購読の URL を発行しました</h2>
			<p>
				この画面を離れると、もう出せません。いまのうちに、RSS リーダーに登録してください。URL
				を知っている人は誰でもあなたの通知を見られるので、人に教えないでください。
			</p>

			<label for="feed-url-rss">RSS (RSS 2.0)</label>
			<div class="copy-row">
				<input
					id="feed-url-rss"
					bind:this={urlField}
					readonly
					value={issued.rss}
					onfocus={(event) => event.currentTarget.select()}
				/>
				<Button type="button" variant="outlined" onclick={() => copyUrl(issued.rss)}>
					<Label>コピー</Label>
				</Button>
			</div>

			<label for="feed-url-atom">Atom (Atom 1.0)</label>
			<div class="copy-row">
				<input
					id="feed-url-atom"
					readonly
					value={issued.atom}
					onfocus={(event) => event.currentTarget.select()}
				/>
				<Button type="button" variant="outlined" onclick={() => copyUrl(issued.atom)}>
					<Label>コピー</Label>
				</Button>
			</div>

			<label for="feed-url-json">JSON Feed (JSON Feed 1.1)</label>
			<div class="copy-row">
				<input
					id="feed-url-json"
					readonly
					value={issued.json}
					onfocus={(event) => event.currentTarget.select()}
				/>
				<Button type="button" variant="outlined" onclick={() => copyUrl(issued.json)}>
					<Label>コピー</Label>
				</Button>
			</div>
			<p class="muted" role="status">{copyState.copied ? 'コピーしました。' : ''}</p>
		</section>
	{/if}

	{#if data.subscription}
		<section aria-labelledby="status-heading">
			<h2 id="status-heading">購読の状態</h2>
			<dl class="status">
				<dt>発行した日時</dt>
				<dd>{data.subscription.createdAt}</dd>
				<dt>RSS リーダーが最後に取りに来た日時</dt>
				<dd>{data.subscription.lastUsedAt ?? 'まだ取りに来ていません'}</dd>
			</dl>
			<p class="muted">
				安全のため、URL はもう一度出せません。別の端末に登録したいときや、URL
				を人に知られたときは、再発行してください。再発行すると前の URL は使えなくなるので、前の URL
				で登録した RSS リーダーからは削除してください。
			</p>
			<div class="actions">
				<form
					method="POST"
					action="?/issue"
					use:enhance={() => {
						copyState.reset();
					}}
				>
					<Button type="submit" variant="unelevated"><Label>再発行する</Label></Button>
				</form>
				<form
					method="POST"
					action="?/revoke"
					use:confirmSubmit={'この購読の URL を無効にします。RSS リーダーに、もう届かなくなります。よろしいですか?'}
					use:enhance
				>
					<Button type="submit" variant="outlined"><Label>無効にする</Label></Button>
				</form>
			</div>
		</section>

		{#if data.kinds}
			<section aria-labelledby="kinds-heading">
				<h2 id="kinds-heading">フィードに載せる通知</h2>
				<form
					method="POST"
					action="?/kinds"
					use:enhance={() =>
						({ update }) =>
							update({ reset: false })}
					class="kinds-form"
				>
					<fieldset>
						<legend>フィードに載せる通知の種類</legend>
						{#each data.kindOptions as option (option.kind)}
							<label>
								<input
									type="checkbox"
									name="kinds"
									value={option.kind}
									checked={data.kinds.includes(option.kind)}
								/>
								{option.label}
							</label>
						{/each}
					</fieldset>
					<Button type="submit" variant="unelevated"><Label>保存する</Label></Button>
				</form>
			</section>
		{/if}
	{:else}
		<section aria-labelledby="issue-heading">
			<h2 id="issue-heading">購読の URL を発行する</h2>
			<p class="muted">発行した URL を、RSS リーダーに登録します。</p>
			<form
				method="POST"
				action="?/issue"
				use:enhance={() => {
					copyState.reset();
				}}
			>
				<Button type="submit" variant="unelevated"><Label>購読の URL を発行する</Label></Button>
			</form>
		</section>
	{/if}
</div>

<style>
	.page {
		max-width: 44rem;
	}

	section {
		margin-top: 2rem;
	}

	.issued {
		padding: 1rem 1.25rem;
		border-radius: 0.75rem;
		background: var(--fm-primary-soft);

		h2 {
			margin-top: 0;
		}

		label {
			display: block;
			margin-top: 1rem;
			font-size: 0.875rem;
		}
	}

	.kinds-form {
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

	fieldset label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 44px;
		margin-top: 0;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.copy-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.25rem;

		input {
			flex: 1 1 10rem;
			min-width: 0;
			min-height: 40px;
			padding: 0 0.5rem;
			font: inherit;
			font-family: ui-monospace, monospace;
			font-size: 0.875rem;
		}
	}

	/* スマホの幅でも日時が折り返さないよう、項目名の下に値を置く */
	.status {
		margin: 0;

		dt {
			color: var(--fm-text-muted);
			font-size: 0.875rem;
		}

		dd {
			margin: 0 0 0.5rem;
		}
	}

	.muted {
		color: var(--fm-text-muted);
		font-size: 0.875rem;
	}

	.message {
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
		background: var(--fm-surface-muted);
	}

	.error {
		padding: 0.75rem 1rem;
		border: 1px solid currentcolor;
		border-radius: 0.25rem;
		color: var(--fm-error);
	}
</style>
