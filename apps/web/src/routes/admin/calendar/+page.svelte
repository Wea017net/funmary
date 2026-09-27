<script lang="ts">
	import Button, { Label } from '@smui/button';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { formatTerm, WEEKDAY_LABELS } from '$lib/term-label.ts';
	import { formatDate } from '$lib/timetable-label.ts';

	type Source = 'manual' | 'auto' | 'estimated';

	interface TermRow {
		term: string;
		start: string | null;
		end: string | null;
		source: Source | null;
	}

	let {
		data,
		form,
	}: {
		data: {
			academicYear: number;
			range: { start: string; end: string };
			terms: TermRow[];
			substituteDays: { date: string; weekday: number }[];
			noClassDays: { date: string; label: string | null }[];
		};
		form: { error?: string; message?: string } | null;
	} = $props();

	const SOURCE_LABELS: Record<Source, string> = {
		manual: '手入力',
		auto: '学年暦から自動',
		estimated: '推定',
	};

	/** クォーターの期間がなければ、それを含む前期か後期の期間を使う */
	const QUARTER_OF: Record<string, string> = { q1: '前期', q2: '前期', q3: '後期', q4: '後期' };

	function sourceLabel(row: TermRow): string {
		if (row.source === null) return '未入力';
		const quarter = QUARTER_OF[row.term];
		if (row.source === 'estimated' && quarter) return `${quarter}と同じ期間`;
		return SOURCE_LABELS[row.source];
	}

	const weekdayName = (weekday: number) =>
		WEEKDAY_LABELS.find((day) => day.weekday === weekday)?.label ?? '?';

	const yearUrl = (year: number) => `${resolve('/admin/calendar')}?year=${year}`;
</script>

<svelte:head>
	<title>学年暦 - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<p><a href={resolve('/admin')}>管理</a></p>
	<h1>{data.academicYear} 年度の学年暦</h1>

	<nav aria-label="年度の切り替え" class="years">
		<!-- eslint-disable svelte/no-navigation-without-resolve -- resolve した /admin/calendar に、年度を足している -->
		<a href={yearUrl(data.academicYear - 1)}>{data.academicYear - 1} 年度</a>
		<a href={yearUrl(data.academicYear + 1)}>{data.academicYear + 1} 年度</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</nav>

	<p>
		大学の学年暦 (PDF)
		を見て入れます。入れていない前期と後期は、既定の規則で推定した期間を使います。1Q から 4Q
		は、入れていなければ前期か後期と同じ期間を使います。
	</p>

	{#if form?.error}
		<p class="error" role="alert">{form.error}</p>
	{:else if form?.message}
		<p class="message" role="status">{form.message}</p>
	{/if}

	<section aria-labelledby="terms-heading">
		<h2 id="terms-heading">学期の期間</h2>
		<table>
			<thead>
				<tr>
					<th scope="col">学期</th>
					<th scope="col">期間と出どころ</th>
					<th scope="col"><span class="visually-hidden">操作</span></th>
				</tr>
			</thead>
			<tbody>
				{#each data.terms as row (row.term)}
					<tr class={{ estimated: row.source === 'estimated' || row.source === null }}>
						<th scope="row">{formatTerm(row.term)}</th>
						<td>
							<span class="numeric">
								{#if row.start && row.end}{row.start} から {row.end}{:else}-{/if}
							</span>
							<span class="source">{sourceLabel(row)}</span>
						</td>
						<td>
							{#if row.source === 'manual' || row.source === 'auto'}
								<form method="POST" action="?/deleteTerm" use:enhance>
									<input type="hidden" name="term" value={row.term} />
									<Button type="submit" variant="outlined">
										<Label>消す<span class="visually-hidden">: {formatTerm(row.term)}</span></Label>
									</Button>
								</form>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>

		<form method="POST" action="?/saveTerm" use:enhance class="entry">
			<label>
				学期
				<select name="term" required>
					{#each data.terms as row (row.term)}
						<option value={row.term}>{formatTerm(row.term)}</option>
					{/each}
				</select>
			</label>
			<label>
				始まりの日
				<input type="date" name="start" min={data.range.start} max={data.range.end} required />
			</label>
			<label>
				終わりの日 (最後の授業日)
				<input type="date" name="end" min={data.range.start} max={data.range.end} required />
			</label>
			<Button type="submit" variant="unelevated"><Label>学期の期間を保存する</Label></Button>
		</form>
	</section>

	<section aria-labelledby="substitute-heading">
		<h2 id="substitute-heading">振替授業日</h2>
		<p class="muted">
			その日は、指定した曜日の授業を行います。祝日でも授業を行う日も、ここに入れます。
		</p>
		{#if data.substituteDays.length === 0}
			<p>ありません。</p>
		{:else}
			<ul class="days">
				{#each data.substituteDays as day (day.date)}
					<li>
						<span
							><time datetime={day.date}>{formatDate(day.date)}</time> は {weekdayName(
								day.weekday,
							)}曜の授業</span
						>
						<form method="POST" action="?/deleteSubstituteDay" use:enhance>
							<input type="hidden" name="date" value={day.date} />
							<Button type="submit" variant="outlined">
								<Label>消す<span class="visually-hidden">: {formatDate(day.date)}</span></Label>
							</Button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}
		<form method="POST" action="?/saveSubstituteDay" use:enhance class="entry">
			<label>
				日付
				<input type="date" name="date" min={data.range.start} max={data.range.end} required />
			</label>
			<label>
				行う授業の曜日
				<select name="weekday" required>
					{#each WEEKDAY_LABELS as day (day.weekday)}
						<option value={day.weekday}>{day.label}曜</option>
					{/each}
				</select>
			</label>
			<Button type="submit" variant="unelevated"><Label>振替授業日を保存する</Label></Button>
		</form>
	</section>

	<section aria-labelledby="no-class-heading">
		<h2 id="no-class-heading">全学の休講日</h2>
		<p class="muted">大学祭などで、全学の授業がない日です。</p>
		{#if data.noClassDays.length === 0}
			<p>ありません。</p>
		{:else}
			<ul class="days">
				{#each data.noClassDays as day (day.date)}
					<li>
						<span
							><time datetime={day.date}>{formatDate(day.date)}</time>{day.label
								? ` (${day.label})`
								: ''}</span
						>
						<form method="POST" action="?/deleteNoClassDay" use:enhance>
							<input type="hidden" name="date" value={day.date} />
							<Button type="submit" variant="outlined">
								<Label>消す<span class="visually-hidden">: {formatDate(day.date)}</span></Label>
							</Button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}
		<form method="POST" action="?/saveNoClassDay" use:enhance class="entry">
			<label>
				日付
				<input type="date" name="date" min={data.range.start} max={data.range.end} required />
			</label>
			<label>
				行事名 (任意)
				<input type="text" name="label" maxlength="100" />
			</label>
			<Button type="submit" variant="unelevated"><Label>全学の休講日を保存する</Label></Button>
		</form>
	</section>
</div>

<style lang="scss">
	.page {
		max-width: 48rem;
	}

	.years {
		display: flex;
		gap: 1.5rem;

		a {
			display: inline-block;
			min-height: 48px;
			line-height: 48px;
		}
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	th,
	td {
		padding: 0.25rem 0.5rem;
		border-bottom: 1px dashed var(--fm-divider);
		text-align: left;
		vertical-align: middle;
	}

	thead th {
		color: var(--fm-text-muted);
		font-size: 0.875rem;
		font-weight: 400;
	}

	.estimated td {
		color: var(--fm-text-muted);
	}

	.source {
		display: block;
		color: var(--fm-text-muted);
		font-size: 0.8125rem;
	}

	tbody th {
		white-space: nowrap;
	}

	.entry {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 0.75rem 1rem;
		margin-top: 1rem;
		padding: 1rem;
		border-radius: 0.75rem;
		background: var(--fm-surface-muted);

		label {
			display: flex;
			flex-direction: column;
			gap: 0.25rem;
			font-size: 0.875rem;
		}
	}

	.days {
		margin: 0;
		padding: 0;
		list-style: none;

		li {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			justify-content: space-between;
			gap: 0.5rem;
			padding: 0.25rem 0;
			border-bottom: 1px dashed var(--fm-divider);
		}
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
