<script lang="ts">
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { resolve } from '$app/paths';
	import { formatSlot, formatTerm } from '$lib/term-label.ts';

	interface SubjectView {
		academicYear: number;
		name: string;
		teacher: string | null;
		credits: number | null;
		term: string;
		attributes: [string, string][];
		syllabus: [string, string][];
		syllabusUrl: string | null;
	}
	interface ChangeView {
		key: string;
		date: string;
		period: number;
		status: 'cancelled' | 'makeup' | 'roomChanged';
		detail: string | null;
		comment: string | null;
		withdrawn: boolean;
	}

	let {
		data,
	}: {
		data: {
			subject: SubjectView;
			slots: { weekday: number; period: number; room: string | null }[];
			registered: boolean;
			hopeCourseUrl: string | null;
			changes: ChangeView[];
		};
	} = $props();

	/** これより長い項目は、折りたたんで出す */
	const LONG_SECTION = 200;
</script>

<svelte:head>
	<title>{data.subject.name} - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<p><a href={resolve('/courses')}>履修科目</a></p>
	<h1>{data.subject.name}</h1>

	<dl class="summary">
		<dt>教員</dt>
		<dd>{data.subject.teacher ?? '不明'}</dd>
		<dt>学期</dt>
		<dd>{data.subject.academicYear} 年度 {formatTerm(data.subject.term)}</dd>
		<dt>単位数</dt>
		<dd>{data.subject.credits === null ? '不明' : `${data.subject.credits} 単位`}</dd>
		<dt>曜日と時限</dt>
		<dd>
			{#if data.slots.length === 0}
				まだ登録されていません
			{:else}
				<ul>
					{#each data.slots as slot (`${slot.weekday}-${slot.period}`)}
						<li>{formatSlot(slot)}、{slot.room ?? '教室は未登録'}</li>
					{/each}
				</ul>
			{/if}
		</dd>
	</dl>

	{#if !data.registered}
		<p>この科目は、履修科目に登録していません。</p>
	{/if}

	<ul class="links">
		{#if data.subject.syllabusUrl}
			<!-- 大学のサイトへのリンク。サーバーが https のものだけを渡す -->
			<li>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a href={data.subject.syllabusUrl} target="_blank" rel="noopener noreferrer"
					>シラバスの原文 (大学のサイト)</a
				>
			</li>
		{/if}
		{#if data.hopeCourseUrl}
			<li>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a href={data.hopeCourseUrl} target="_blank" rel="noopener noreferrer">HOPE のコース</a>
			</li>
		{/if}
	</ul>

	<section aria-labelledby="changes-heading">
		<h2 id="changes-heading">休講、補講、教室変更</h2>
		{#if data.changes.length === 0}
			<p>ありません。</p>
		{:else}
			<ul class="changes">
				{#each data.changes as change (change.key)}
					<li class={{ withdrawn: change.withdrawn }}>
						<StatusBadge status={change.status} />
						{change.date}
						{change.period} 限{#if change.detail}、{change.detail}{/if}
						{#if change.withdrawn}(取り消されました){/if}
						{#if change.comment}<p class="comment">{change.comment}</p>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if data.subject.attributes.length > 0}
		<section aria-labelledby="attributes-heading">
			<h2 id="attributes-heading">科目の情報</h2>
			<dl class="attributes">
				{#each data.subject.attributes as [label, value] (label)}
					<dt>{label}</dt>
					<dd>{value}</dd>
				{/each}
			</dl>
		</section>
	{/if}

	<section aria-labelledby="syllabus-heading">
		<h2 id="syllabus-heading">シラバス</h2>
		{#if data.subject.syllabus.length === 0}
			<p>シラバスの内容は、まだ取り込まれていません。</p>
		{:else}
			{#each data.subject.syllabus as [label, text] (label)}
				<details open={text.length <= LONG_SECTION}>
					<summary>{label}</summary>
					<p class="section">{text}</p>
				</details>
			{/each}
		{/if}
	</section>
</div>

<style>
	.page {
		max-width: 40rem;
	}
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.25rem 1rem;
	}
	dt {
		color: var(--fm-text-muted);
	}
	dd {
		margin: 0;
	}
	dd ul {
		margin: 0;
		padding-left: 1.25rem;
	}
	.changes {
		padding: 0;
		list-style: none;
	}
	.changes li {
		margin: 0.5rem 0;
	}
	.withdrawn {
		color: var(--fm-text-muted);
	}
	.comment,
	.section {
		margin: 0.25rem 0 0.75rem;
		white-space: pre-line;
	}
	summary {
		min-height: 48px;
		display: flex;
		align-items: center;
		cursor: pointer;
		font-weight: bold;
	}
	summary::before {
		content: '▸';
		margin-right: 0.5rem;
	}
	details[open] > summary::before {
		content: '▾';
	}
</style>
