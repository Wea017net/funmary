<script lang="ts">
	import Button, { Label } from '@smui/button';
	import { resolve } from '$app/paths';

	interface EventRow {
		id: number;
		title: string;
		location: string | null;
		when: string;
		time: string;
		repeat: string | null;
	}

	let { data }: { data: { message: string | null; events: EventRow[] } } = $props();
</script>

<svelte:head>
	<title>自分の予定 - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<p><a href={resolve('/app/week')}>時間割</a></p>
	<h1>自分の予定</h1>
	<p>
		サークル、課外活動、合宿など、授業のほかの予定を足します。足した予定は、あなただけに見えて、今日と週の画面に出ます。
	</p>

	{#if data.message}
		<p class="message" role="status">{data.message}</p>
	{/if}

	<Button href={resolve('/app/events/new')} variant="unelevated">
		<Label>予定を足す</Label>
	</Button>

	{#if data.events.length === 0}
		<p>まだ予定がありません。</p>
	{:else}
		<ul class="events">
			{#each data.events as event (event.id)}
				<li>
					<p class="title">{event.title}</p>
					<p class="meta">{event.when}、{event.time}</p>
					{#if event.repeat}<p class="meta">繰り返し: {event.repeat}</p>{/if}
					{#if event.location}<p class="meta">場所: {event.location}</p>{/if}
					<a class="edit" href={resolve('/app/events/[id]', { id: String(event.id) })}>
						編集<span class="visually-hidden">: {event.title}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.page {
		max-width: 44rem;
	}
	.events {
		padding: 0;
		list-style: none;
	}
	.events > li {
		margin: 0.75rem 0;
		padding: 0.75rem 1rem;
		border: 1px solid var(--fm-divider);
		border-radius: 0.5rem;
	}
	.title {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 500;
	}
	.meta {
		margin: 0;
		color: var(--fm-text-muted);
		font-size: 0.875rem;
	}
	.edit {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
	}
	.message {
		padding: 0.75rem 1rem;
		border: 1px solid currentcolor;
		border-radius: 0.25rem;
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
