<script lang="ts">
	import { resolve } from '$app/paths';
	import type { SourceStatusRow } from '$lib/server/source-status.ts';
	import { SOURCE_STATE_LABELS } from '$lib/source-label.ts';

	interface RunRow {
		id: number;
		job: string;
		startedAt: string;
		seconds: number | null;
		status: 'running' | 'succeeded' | 'failed' | 'skipped';
		message: string | null;
	}

	let { data }: { data: { sources: SourceStatusRow[]; runs: RunRow[] } } = $props();

	const RUN_LABELS = {
		running: '実行中',
		succeeded: '成功',
		failed: '失敗',
		skipped: '見送り',
	} as const;
</script>

<svelte:head>
	<title>取得元と実行履歴 - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<p><a href={resolve('/app/admin')}>管理</a></p>
	<h1>取得元と実行履歴</h1>

	<section aria-labelledby="sources-heading">
		<h2 id="sources-heading">取得元の状態</h2>
		<p class="muted">
			3 回続けて失敗すると「不調」になり、次に試すまでの間隔が延びます。時刻は日本時間です。
		</p>
		<ul class="sources">
			{#each data.sources as source (source.source)}
				<li>
					<div class="source-head">
						<h3>{source.label}</h3>
						<span class={['state', source.state]}>{SOURCE_STATE_LABELS[source.state]}</span>
					</div>
					{#if source.state !== 'never'}
						<dl>
							<dt>最終成功</dt>
							<dd class="numeric">{source.lastSuccessAt ?? 'なし'}</dd>
							<dt>最終試行</dt>
							<dd class="numeric">{source.lastAttemptAt ?? 'なし'}</dd>
							<dt>連続の失敗</dt>
							<dd class="numeric">{source.consecutiveFailures} 回</dd>
							{#if source.nextAttemptAt}
								<dt>次の試行</dt>
								<dd class="numeric">{source.nextAttemptAt}</dd>
							{/if}
							{#if source.lastError}
								<dt>直近の失敗</dt>
								<dd class="error-text">{source.lastError}</dd>
							{/if}
						</dl>
					{/if}
				</li>
			{/each}
		</ul>
	</section>

	<section aria-labelledby="runs-heading">
		<h2 id="runs-heading">定期処理の実行履歴</h2>
		{#if data.runs.length === 0}
			<p>まだ記録がありません。</p>
		{:else}
			<div class="scroll">
				<table>
					<thead>
						<tr>
							<th scope="col">始まり</th>
							<th scope="col">処理</th>
							<th scope="col">結果</th>
							<th scope="col">かかった時間</th>
						</tr>
					</thead>
					<tbody>
						{#each data.runs as run (run.id)}
							<tr>
								<td class="numeric">{run.startedAt}</td>
								<td>{run.job}</td>
								<td>
									<span class={['run', run.status]}>{RUN_LABELS[run.status]}</span>
									{#if run.message}<span class="message">{run.message}</span>{/if}
								</td>
								<td class="numeric">{run.seconds === null ? '-' : `${run.seconds} 秒`}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>

<style lang="scss">
	.page {
		max-width: 56rem;
	}

	.sources {
		margin: 0;
		padding: 0;
		list-style: none;

		li {
			padding: 0.75rem 0;
			border-bottom: 1px dashed var(--fm-divider);
		}
	}

	.source-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.75rem;

		h3 {
			margin: 0;
			font-size: 1rem;
		}
	}

	dl {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0 1rem;
		margin: 0.5rem 0 0;
		font-size: 0.875rem;
	}

	dt {
		color: var(--fm-text-muted);
	}

	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	/* 状態は、色だけでなく文字でも示す */
	.state,
	.run {
		display: inline-block;
		padding: 0 0.5rem;
		border-radius: 0.375rem;
		font-size: 0.8125rem;
		font-weight: 700;
		white-space: nowrap;
	}

	.ok,
	.succeeded {
		background: var(--fm-makeup-soft);
		color: var(--fm-makeup);
	}

	.failing,
	.skipped,
	.running {
		background: var(--fm-room-changed-soft);
		color: var(--fm-room-changed);
	}

	.unhealthy,
	.failed {
		background: var(--fm-cancelled-soft);
		color: var(--fm-cancelled);
	}

	.never {
		background: var(--fm-surface-muted);
		color: var(--fm-text-muted);
	}

	.error-text {
		color: var(--fm-error);
	}

	.scroll {
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	th,
	td {
		padding: 0.5rem;
		border-bottom: 1px dashed var(--fm-divider);
		text-align: left;
		vertical-align: top;
	}

	thead th {
		color: var(--fm-text-muted);
		font-weight: 400;
		white-space: nowrap;
	}

	td.numeric {
		white-space: nowrap;
	}

	.message {
		display: block;
		margin-top: 0.25rem;
		color: var(--fm-text-muted);
		overflow-wrap: anywhere;
	}
</style>
