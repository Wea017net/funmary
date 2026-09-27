<script lang="ts">
	import { STATUS_LABELS } from '$lib/timetable-label.ts';

	// 休講などを、色に加えて文字とアイコンで示す (設計書 12.3)。ふだんの授業には何も出さない
	let { status }: { status: 'normal' | 'cancelled' | 'makeup' | 'roomChanged' } = $props();
</script>

{#if status !== 'normal'}
	<span class={['badge', status]}>
		<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
			{#if status === 'cancelled'}
				<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2" />
				<line x1="4" y1="12" x2="12" y2="4" stroke="currentColor" stroke-width="2" />
			{:else if status === 'makeup'}
				<line x1="8" y1="3" x2="8" y2="13" stroke="currentColor" stroke-width="2" />
				<line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" stroke-width="2" />
			{:else}
				<polyline
					points="2,8 13,8 9,4 13,8 9,12"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linejoin="round"
				/>
			{/if}
		</svg>
		{STATUS_LABELS[status]}
	</span>
{/if}

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0 0.5rem;
		border: 1px solid currentcolor;
		border-radius: 0.25rem;
		font-weight: bold;
		font-size: 0.875rem;
		white-space: nowrap;
	}
	.cancelled {
		color: #b3261e;
		background: #fdecea;
	}
	.makeup {
		color: #2e7d32;
		background: #edf7ee;
	}
	.roomChanged {
		color: #8a6d00;
		background: #fdf6d3;
	}
</style>
