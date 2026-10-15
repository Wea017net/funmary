<script lang="ts">
	import Button, { Label } from '@smui/button';
	import type { CopyState } from '#lib/clipboard.svelte.ts';

	let {
		label,
		value,
		copyState,
	}: {
		label: string;
		value: string;
		copyState: CopyState;
	} = $props();
</script>

<div class="snippet">
	<p class="label">{label}</p>
	<pre><code>{value}</code></pre>
	<Button type="button" variant="outlined" onclick={() => copyState.copy(value)}>
		<Label>コピー</Label>
	</Button>
</div>

<style lang="scss">
	.snippet {
		margin-top: 1rem;
	}

	.label {
		margin: 0 0 0.25rem;
		font-size: 0.875rem;
	}

	pre {
		margin: 0 0 0.5rem;
		padding: 0.75rem;
		overflow-x: auto;
		border: 1px solid var(--fm-divider);
		border-radius: 0.5rem;
		background: var(--fm-surface-muted);
		font-size: 0.8125rem;
	}
</style>
