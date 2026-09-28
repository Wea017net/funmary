<script lang="ts">
	import { resolve } from '$app/paths';

	/** 設定の下の画面の、現在地の名前 (画面の見出しと同じにする) */
	let { current }: { current: string } = $props();
</script>

<nav aria-label="パンくず" class="breadcrumb">
	<ol>
		<li><a href={resolve('/app/settings')}>設定</a></li>
		<li aria-current="page">{current}</li>
	</ol>
</nav>

<style>
	.breadcrumb ol {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		margin: 0;
		padding: 0;
		list-style: none;
		color: var(--fm-text-muted);
		font-size: 0.875rem;
	}
	li + li::before {
		content: '>';
		margin: 0 0.5rem;
	}
	a {
		display: inline-flex;
		align-items: center;
		/* 押せる範囲を 44px 以上にする */
		min-height: 44px;
	}
</style>
