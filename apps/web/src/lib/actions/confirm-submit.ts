// 破壊的な操作 (削除、取り消し、退会など) の前に、確認のポップアップを出す Svelte のアクション。
// ブラウザ標準の confirm() を使うので、新しい依存は要らない。JavaScript が無効なブラウザでは
// 確認なしでそのまま送信される (フォームの送信自体は動く)。
//
// use:enhance と同じ <form> に付けるときは、この決まりを守る。
//
//     <form use:confirmSubmit={'…'} use:enhance>
//
// use:enhance より先に書くこと。Svelte のアクションは書いた順に登録され、後から登録した
// リスナーほど先に呼ばれる。confirmSubmit を先に書けば、あとから登録される enhance のリスナーより
// 先に確認でき、断ったときに stopImmediatePropagation で enhance の送信処理も止められる。
export function confirmSubmit(node: HTMLFormElement, message: string) {
	let currentMessage = message;
	const onSubmit = (event: SubmitEvent) => {
		if (confirm(currentMessage)) return;
		event.preventDefault();
		event.stopImmediatePropagation();
	};
	node.addEventListener('submit', onSubmit);
	return {
		update(newMessage: string) {
			currentMessage = newMessage;
		},
		destroy() {
			node.removeEventListener('submit', onSubmit);
		},
	};
}
