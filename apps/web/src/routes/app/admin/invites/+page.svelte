<script lang="ts">
	import Button, { Label } from '@smui/button';
	import type { InviteIssuers, InviteSettings } from '@funmary/core';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import InviteCodeList from '$lib/components/InviteCodeList.svelte';
	import type { InviteCodeView } from '$lib/server/invites.ts';

	let {
		data,
		form,
	}: {
		data: {
			settings: InviteSettings;
			registration: 'invite' | 'open' | 'closed';
			codes: InviteCodeView[];
			users: { id: string; email: string; suspended: boolean; canInvite: boolean }[];
		};
		form: { error?: string; message?: string } | null;
	} = $props();

	const ISSUERS: { value: InviteIssuers; label: string; description: string }[] = [
		{ value: 'admin', label: '管理者のみ', description: '管理者だけが発行できます。' },
		{
			value: 'permitted',
			label: '許可したユーザー',
			description: '管理者と、下の一覧で許可した人が発行できます。',
		},
		{ value: 'anyone', label: '誰でも', description: 'ログインしている全員が発行できます。' },
	];
</script>

<svelte:head>
	<title>招待コードの管理 - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<p><a href={resolve('/app/admin')}>管理</a></p>
	<h1>招待コードの管理</h1>
	<p>招待コードの発行は、<a href={resolve('/app/invites')}>招待</a> の画面で行います。</p>
	{#if data.registration !== 'invite'}
		<p class="muted">
			いまの登録の方式 (REGISTRATION) は {data.registration} なので、招待コードは登録に使われません。
		</p>
	{/if}

	{#if form?.error}
		<p class="error" role="alert">{form.error}</p>
	{:else if form?.message}
		<p class="message" role="status">{form.message}</p>
	{/if}

	<section aria-labelledby="settings-heading">
		<h2 id="settings-heading">発行できる人</h2>
		<form method="POST" action="?/saveSettings" use:enhance class="entry">
			<fieldset>
				<legend>モード</legend>
				{#each ISSUERS as issuer (issuer.value)}
					<label class="choice">
						<input
							type="radio"
							name="issuers"
							value={issuer.value}
							checked={data.settings.issuers === issuer.value}
						/>
						<span>
							<span class="choice-label">{issuer.label}</span>
							<span class="muted">{issuer.description}</span>
						</span>
					</label>
				{/each}
			</fieldset>
			<label class="limit">
				管理者でない人が 1 か月に発行できる数
				<input
					type="number"
					name="monthlyLimit"
					min="0"
					max="100"
					value={data.settings.monthlyLimit}
					required
				/>
			</label>
			<p class="muted">
				管理者でない人のコードは、1 回だけ使えて、30
				日で期限が切れます。管理者は制限なく発行できます。
			</p>
			<Button type="submit" variant="unelevated"><Label>保存する</Label></Button>
		</form>
	</section>

	<section aria-labelledby="users-heading">
		<h2 id="users-heading">発行を許可する人</h2>
		<p class="muted">
			モードが「許可したユーザー」のときに使います。管理者は、許可しなくても発行できます。
		</p>
		{#if data.users.length === 0}
			<p class="muted">管理者のほかに、利用者はいません。</p>
		{:else}
			<ul class="users">
				{#each data.users as user (user.id)}
					<li>
						<span class="email">
							{user.email}{#if user.suspended}<span class="muted"> (停止中)</span>{/if}
						</span>
						<form method="POST" action="?/setPermission" use:enhance>
							<input type="hidden" name="userId" value={user.id} />
							<input type="hidden" name="granted" value={String(!user.canInvite)} />
							<Button type="submit" variant={user.canInvite ? 'outlined' : 'unelevated'}>
								<Label
									>{user.canInvite ? '許可を外す' : '許可する'}<span class="visually-hidden"
										>: {user.email}</span
									></Label
								>
							</Button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section aria-labelledby="codes-heading">
		<h2 id="codes-heading">発行された招待コード</h2>
		<InviteCodeList codes={data.codes} showIssuer />
	</section>
</div>

<style>
	.page {
		max-width: 48rem;
	}

	section {
		margin-top: 2rem;
	}

	.entry {
		display: grid;
		gap: 1rem;
		padding: 1rem;
		border-radius: 0.75rem;
		background: var(--fm-surface-muted);
		justify-items: start;
	}

	fieldset {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		border: 0;
	}

	legend {
		margin-bottom: 0.25rem;
		font-size: 0.875rem;
	}

	.choice {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		min-height: 44px;

		input {
			margin-top: 0.25rem;
		}

		> span {
			display: flex;
			flex-direction: column;
		}
	}

	.choice-label {
		font-weight: 700;
	}

	.limit {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.875rem;
	}

	.users {
		margin: 0;
		padding: 0;
		list-style: none;

		li {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			justify-content: space-between;
			gap: 0.5rem;
			padding: 0.5rem 0;
			border-bottom: 1px dashed var(--fm-divider);
		}
	}

	/* 文言が変わっても、ボタンの幅と位置を変えない */
	.users form :global(button) {
		min-width: 8rem;
	}

	.email {
		overflow-wrap: anywhere;
	}

	.muted {
		color: var(--fm-text-muted);
		font-size: 0.875rem;
	}

	.message,
	.error {
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
		background: var(--fm-surface-muted);
	}

	.error {
		color: var(--fm-error);
	}
</style>
