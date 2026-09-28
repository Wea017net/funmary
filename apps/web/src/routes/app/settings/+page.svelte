<script lang="ts">
	import type { Component } from 'svelte';
	import { resolve } from '$app/paths';
	import InstallGuide from '$lib/components/InstallGuide.svelte';
	import type { AdminSummary } from '$lib/server/admin-summary.ts';
	import IconCalendar from '~icons/material-symbols/calendar-add-on-outline';
	import IconChevron from '~icons/material-symbols/chevron-right';
	import IconHistory from '~icons/material-symbols/monitor-heart-outline';
	import IconInvite from '~icons/material-symbols/person-add-outline';
	import IconLink from '~icons/material-symbols/link';
	import IconSchool from '~icons/material-symbols/event-note-outline';
	import IconUpload from '~icons/material-symbols/upload-file-outline';

	let {
		data,
	}: {
		data: {
			admin: AdminSummary | null;
			canInvite: boolean;
			documents: { title: string; url: string }[];
		};
	} = $props();

	interface Item {
		href: string;
		icon: Component;
		title: string;
		description: string;
		/** 管理者に手を入れてほしいことがあるとき */
		attention?: boolean;
	}

	const personal = $derived.by((): Item[] => [
		{
			href: resolve('/app/settings/calendar'),
			icon: IconCalendar,
			title: 'カレンダーの購読',
			description: '授業の予定を、Google カレンダーや iPhone のカレンダーに入れる',
		},
		...(data.canInvite
			? [
					{
						href: resolve('/app/invites'),
						icon: IconInvite,
						title: '招待',
						description: '友だちを招待するコードを発行する',
					},
				]
			: []),
	]);

	const adminItems = $derived.by((): Item[] => {
		const admin = data.admin;
		if (!admin) return [];
		return [
			{
				href: resolve('/app/admin/lessons'),
				icon: IconLink,
				title: '照合できなかった授業名',
				description:
					admin.unresolvedLessons > 0
						? `${admin.unresolvedLessons} 件を、科目に紐付けてください`
						: 'すべて紐付け済みです',
				attention: admin.unresolvedLessons > 0,
			},
			{
				href: resolve('/app/admin/calendar'),
				icon: IconSchool,
				title: '学年暦',
				description:
					admin.estimatedTerms > 0
						? `${admin.calendarYear} 年度の前期と後期のうち ${admin.estimatedTerms} つが推定のままです`
						: `${admin.calendarYear} 年度は入力済みです`,
				attention: admin.estimatedTerms > 0,
			},
			{
				href: resolve('/app/admin/timetable'),
				icon: IconUpload,
				title: '授業時間割の取り込み',
				description: '大学が配る PDF から、曜日、時限、教室を入れる',
			},
			{
				href: resolve('/app/admin/invites'),
				icon: IconInvite,
				title: '招待コード',
				description: '発行できる人と、発行されたコード',
			},
			{
				href: resolve('/app/admin/status'),
				icon: IconHistory,
				title: '取得元と実行履歴',
				description: '学生ポータルなどの取得の状態と、定期処理の記録',
			},
		];
	});
</script>

<svelte:head>
	<title>設定 - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#snippet links(items: Item[])}
	<ul class="links">
		{#each items as item (item.href)}
			<li>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href は resolve 済み -->
				<a href={item.href}>
					<item.icon aria-hidden="true" class="icon" />
					<span class="text">
						<span class="title">{item.title}</span>
						<span class={['description', { attention: item.attention }]}>{item.description}</span>
					</span>
					<IconChevron aria-hidden="true" class="icon" />
				</a>
			</li>
		{/each}
	</ul>
{/snippet}

<div class="page">
	<h1>設定</h1>
	{@render links(personal)}

	{#if data.documents.length > 0}
		<section aria-labelledby="documents-heading">
			<h2 id="documents-heading">大学の公式の資料</h2>
			<p class="muted">
				大学が配っている PDF を、大学のサイトで開きます (新しいタブ)。Funmary
				が作ったものではありません。
			</p>
			<ul class="documents">
				{#each data.documents as document (document.url)}
					<li>
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- 大学のサイトへの外部リンク。サーバーで大学サイトの https の PDF だと確かめてある -->
						<a href={document.url} target="_blank" rel="noopener noreferrer">
							{document.title} (PDF)
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<InstallGuide />

	{#if data.admin}
		<section id="admin" aria-labelledby="admin-heading">
			<h2 id="admin-heading">管理</h2>
			<p class="muted">管理者にだけ出ています。</p>
			{@render links(adminItems)}
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

	.documents {
		margin: 0;
		padding: 0;
		list-style: none;

		a {
			display: inline-flex;
			align-items: center;
			min-height: 44px;
		}
	}

	.links {
		display: grid;
		gap: 0.5rem;
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

	.description,
	.muted {
		color: var(--fm-text-muted);
		font-size: 0.875rem;
	}

	.description.attention {
		color: var(--fm-primary);
		font-weight: 700;
	}
</style>
