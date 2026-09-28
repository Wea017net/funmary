<script lang="ts">
	import Button, { Label } from '@smui/button';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { TERMS } from '@funmary/core';
	import { formatTerm } from '$lib/term-label.ts';

	interface UnresolvedLesson {
		lessonName: string;
		firstSeenAt: string;
		lastSeenAt: string;
		candidates: { id: number; label: string }[];
	}

	let {
		data,
		form,
	}: {
		data: { academicYear: number | null; lessons: UnresolvedLesson[]; defaultTerm: string };
		form: { error?: string; message?: string } | null;
	} = $props();

	const formatDate = (iso: string) =>
		new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
</script>

<svelte:head>
	<title>照合できなかった授業名 - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<p><a href={resolve('/app/settings')}>設定</a></p>
	<h1>照合できなかった授業名</h1>

	{#if form?.error}
		<p class="error" role="alert">{form.error}</p>
	{:else if form?.message}
		<p class="message" role="status">{form.message}</p>
	{/if}

	{#if data.academicYear === null}
		<p>科目がまだ取り込まれていません。</p>
	{:else if data.lessons.length === 0}
		<p>{data.academicYear} 年度には、照合できなかった授業名はありません。</p>
	{:else}
		<p>
			{data.academicYear}
			年度の科目に紐付けます。紐付けると、その名前の休講などにすぐ科目が入り、次の取得からも使われます。誤った科目に紐付けると、別の授業の休講を知らせてしまうので、確かめてから紐付けてください。
		</p>
		<ul class="lessons">
			{#each data.lessons as lesson (lesson.lessonName)}
				<li>
					<h2>{lesson.lessonName}</h2>
					<p class="meta">
						最初に見た時刻 {formatDate(lesson.firstSeenAt)}、最後に見た時刻 {formatDate(
							lesson.lastSeenAt,
						)}
					</p>
					<form method="POST" action="?/resolve" use:enhance>
						<input type="hidden" name="lessonName" value={lesson.lessonName} />
						<fieldset>
							<legend>紐付ける科目</legend>
							{#each lesson.candidates as candidate (candidate.id)}
								<label class="choice">
									<input type="radio" name="subjectId" value={candidate.id} />
									{candidate.label}
								</label>
							{:else}
								<p>似た名前の科目はありません。</p>
							{/each}
							<label>
								候補にないときは、シラバスの番号
								<input name="syllabusId" inputmode="numeric" autocomplete="off" />
							</label>
						</fieldset>
						<Button type="submit" variant="unelevated"><Label>紐付ける</Label></Button>
					</form>
					<details>
						<summary>シラバスにない授業として、科目を作って紐付ける</summary>
						<form method="POST" action="?/createSubject" use:enhance class="create">
							<input type="hidden" name="lessonName" value={lesson.lessonName} />
							<label>
								授業の名前
								<input name="name" maxlength="100" required value={lesson.lessonName} />
							</label>
							<label>
								学期
								<select name="term" required value={data.defaultTerm}>
									{#each TERMS as term (term)}
										<option value={term}>{formatTerm(term)}</option>
									{/each}
								</select>
							</label>
							<label>
								教員 (任意)
								<input name="teacher" maxlength="100" />
							</label>
							<Button type="submit" variant="outlined"><Label>作って紐付ける</Label></Button>
						</form>
					</details>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.page {
		max-width: 48rem;
	}
	.lessons {
		padding: 0;
		list-style: none;
	}
	summary {
		min-height: 44px;
		align-content: center;
		cursor: pointer;
	}
	.create {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 0.5rem 1rem;

		label {
			display: flex;
			flex-direction: column;
			gap: 0.25rem;
			font-size: 0.875rem;
		}
	}
	.lessons > li {
		margin: 0.75rem 0;
		padding: 0.75rem 1rem;
		border: 1px solid var(--fm-divider);
		border-radius: 0.5rem;
	}
	h2 {
		margin: 0;
		font-size: 1.1rem;
	}
	.meta {
		margin: 0;
		color: var(--fm-text-muted);
	}
	fieldset {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		border: none;
		padding: 0;
		margin: 0.5rem 0;
	}
	.choice {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 48px;
	}
	.message,
	.error {
		padding: 0.75rem 1rem;
		border: 1px solid currentcolor;
		border-radius: 0.25rem;
	}
	.error {
		color: var(--fm-error);
	}
</style>
