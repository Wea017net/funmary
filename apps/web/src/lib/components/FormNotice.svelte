<script lang="ts">
	// フォームの操作の結果 (失敗の理由か、成功の知らせ) を出す、小さな帯。両方渡したときは、失敗を優先する
	let { error = null, message = null }: { error?: string | null; message?: string | null } =
		$props();
</script>

{#if error}
	<p class="notice error" role="alert">{error}</p>
{:else if message}
	<p class="notice" role="status">{message}</p>
{/if}

<style lang="scss">
	.notice {
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
		background: var(--fm-surface-muted);
		overflow-wrap: anywhere;

		&.error {
			color: var(--fm-error);
		}
	}
</style>
