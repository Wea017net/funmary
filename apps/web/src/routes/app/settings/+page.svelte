<script lang="ts">
	import { resolve } from '$app/paths';
	import IconCalendar from '~icons/material-symbols/calendar-add-on-outline';
	import IconChevron from '~icons/material-symbols/chevron-right';
</script>

<svelte:head>
	<title>設定 - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<h1>設定</h1>
	<ul class="links">
		<li>
			<a href={resolve('/app/settings/calendar')}>
				<IconCalendar aria-hidden="true" class="icon" />
				<span class="text">
					<span class="title">カレンダーの購読</span>
					<span class="muted">授業の予定を、Google カレンダーや iPhone のカレンダーに入れる</span>
				</span>
				<IconChevron aria-hidden="true" class="icon chevron" />
			</a>
		</li>
	</ul>
</div>

<style>
	.page {
		max-width: 44rem;
	}

	.links {
		margin: 0;
		padding: 0;
		list-style: none;

		a {
			display: flex;
			align-items: center;
			gap: 0.75rem;
			min-height: 56px;
			padding: 0.75rem 1rem;
			border-radius: 0.75rem;
			background: var(--fm-surface-muted);
			color: inherit;
			text-decoration: none;
		}

		a:hover {
			background: var(--fm-primary-soft);
		}

		:global(.icon) {
			flex: none;
			width: 1.5rem;
			height: 1.5rem;
		}
	}

	.text {
		display: flex;
		flex: 1;
		flex-direction: column;
	}

	.title {
		font-weight: 700;
	}

	.muted {
		color: var(--fm-text-muted);
		font-size: 0.875rem;
	}
</style>
