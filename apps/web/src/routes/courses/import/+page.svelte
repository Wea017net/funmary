<script lang="ts">
	import { onMount } from 'svelte';

	interface ImportSummary {
		read: number;
		rejected: number;
		registered: number;
		slotsAdded: number;
		slotsUpdated: number;
		unknown: number;
		conflicts: number;
	}

	let {
		data,
		form,
	}: {
		data: { bookmarklet: string };
		form: { error?: string; result?: ImportSummary } | null;
	} = $props();

	/** ブックマークレットが URL の # 以降に入れた内容。サーバーには、ボタンを押したときだけ送る */
	let payload = $state('');

	onMount(() => {
		const hash = location.hash.slice(1);
		if (hash === '') return;
		payload = hash;
		// 再読み込みや、履歴から開き直したときに、同じ内容が残らないよう、URL から消す
		history.replaceState(history.state, '', location.pathname + location.search);
	});
</script>

<svelte:head>
	<title>時間割の取り込み - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main>
	<h1>ポータルの時間割から取り込む</h1>

	<p class="note">
		授業の曜日、時限、教室は、大学から自動では取得できません。そのため、利用者どうしで登録しています。
		ここで取り込んだ曜日、時限、教室は、同じ科目を履修しているほかの利用者の時間割にも使われます。
	</p>

	{#if form?.error}
		<p class="error" role="alert">{form.error}</p>
	{/if}

	{#if form?.result}
		<section aria-labelledby="result-heading">
			<h2 id="result-heading">取り込みの結果</h2>
			<ul>
				<li>読み取ったコマ: {form.result.read} 件</li>
				<li>新しく履修登録した科目: {form.result.registered} 件</li>
				<li>新しく登録した曜日と時限: {form.result.slotsAdded} 件</li>
				{#if form.result.slotsUpdated > 0}
					<li>教室を埋めた枠: {form.result.slotsUpdated} 件</li>
				{/if}
				{#if form.result.unknown > 0}
					<li>
						まだ Funmary に取り込まれていない科目: {form.result.unknown} 件 (シラバスの取り込みのあとに、もう一度お試しください)
					</li>
				{/if}
				{#if form.result.conflicts > 0}
					<li>
						ほかの利用者の登録と教室が違ったもの: {form.result.conflicts} 件 (上書きせず、管理者が確かめます)
					</li>
				{/if}
				{#if form.result.rejected > 0}
					<li>読めなかったコマ: {form.result.rejected} 件</li>
				{/if}
			</ul>
		</section>
	{/if}

	{#if payload}
		<form method="POST">
			<input type="hidden" name="payload" value={payload} />
			<p>ポータルの時間割を読み取りました。取り込むと、履修科目として登録します。</p>
			<button type="submit">取り込む</button>
		</form>
	{:else}
		<h2>使い方</h2>
		<ol>
			<li>
				下のリンクを、ブラウザのブックマークバーにドラッグして登録します。
				<!-- ブックマークレットは、画面の経路ではない。サーバーが決まったコードから作った値だけを入れる -->
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a class="bookmarklet" href={data.bookmarklet}>Funmary に時間割を取り込む</a>
			</li>
			<li>学生ポータルにログインし、時間割のページ (Pt/TimeTable) を開きます。</li>
			<li>登録したブックマークを押すと、この画面に戻ります。「取り込む」を押してください。</li>
		</ol>
		<p>
			ポータルのパスワードは、Funmary
			には送られません。読み取りは、あなたのブラウザの中だけで行います。
		</p>
	{/if}
</main>

<style>
	main {
		max-width: 40rem;
		margin: 0 auto;
		padding: 1rem;
		font-family: system-ui, sans-serif;
		line-height: 1.7;
	}
	.note {
		padding: 0.75rem 1rem;
		border-left: 4px solid currentcolor;
		background: color-mix(in srgb, currentcolor 6%, transparent);
	}
	.error {
		padding: 0.75rem 1rem;
		border: 1px solid currentcolor;
		border-radius: 0.25rem;
		color: #b3261e;
	}
	.bookmarklet {
		display: inline-block;
		margin: 0.25rem 0;
		padding: 0.25rem 0.75rem;
		border: 1px dashed currentcolor;
		border-radius: 0.25rem;
	}
</style>
