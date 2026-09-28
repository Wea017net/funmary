<script lang="ts">
	import Button, { Label } from '@smui/button';
	import { enhance } from '$app/forms';
	import type { InviteCodeView, InviteState } from '$lib/server/invites.ts';

	// 招待コードの一覧。発行の画面 (自分のコード) と管理画面 (全員のコード) で使う
	let { codes, showIssuer = false }: { codes: readonly InviteCodeView[]; showIssuer?: boolean } =
		$props();

	const STATE_LABELS: Record<InviteState, string> = {
		active: '使える',
		'used-up': '使い切り',
		expired: '期限切れ',
		revoked: '取り消し済み',
	};
</script>

{#if codes.length === 0}
	<p class="muted">まだ招待コードはありません。</p>
{:else}
	<ul class="codes">
		{#each codes as code (code.id)}
			<li class={{ inactive: code.state !== 'active' }}>
				<div class="summary">
					<span class="note">{code.note ?? '(メモなし)'}</span>
					<span class="state">{STATE_LABELS[code.state]}</span>
				</div>
				<p class="detail">
					使用 {code.usedCount} / {code.maxUses} 回、期限 {code.expiresAt ?? 'なし'}、発行
					{code.createdAt}
					{#if showIssuer}、発行者 {code.createdByEmail ?? '(管理用コマンド)'}{/if}
				</p>
				{#if code.state === 'active'}
					<form method="POST" action="?/revoke" use:enhance>
						<input type="hidden" name="id" value={code.id} />
						<Button type="submit" variant="outlined">
							<Label
								>取り消す<span class="visually-hidden">: {code.note ?? '(メモなし)'}</span></Label
							>
						</Button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.codes {
		margin: 0;
		padding: 0;
		list-style: none;

		li {
			display: grid;
			gap: 0.25rem;
			padding: 0.75rem 0;
			border-bottom: 1px dashed var(--fm-divider);
		}
	}

	.summary {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.note {
		font-weight: 700;
		overflow-wrap: anywhere;
	}

	.state {
		font-size: 0.875rem;
	}

	.detail {
		margin: 0;
		color: var(--fm-text-muted);
		font-size: 0.8125rem;
		font-variant-numeric: tabular-nums;
		overflow-wrap: anywhere;
	}

	.inactive .note,
	.inactive .state {
		color: var(--fm-text-muted);
	}

	.muted {
		color: var(--fm-text-muted);
	}
</style>
