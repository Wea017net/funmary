// 破壊的な操作 (削除、取り消し、退会など) の前に、確認のポップアップを出す Svelte のアクション。
// ブラウザ標準の confirm() を使うので、新しい依存は要らない。JavaScript が無効なブラウザでは
// 確認なしでそのまま送信される (フォームの送信自体は動く)。
//
// use:enhance と同じ <form> に付けてよく、書く順は問わない。enhance は submit のリスナーを
// ふつうに (バブリングで) 登録し、ほかのリスナーが送信を止めたかを見ずに送信する。そこで、こちらは
// 捕捉 (capture) で登録する。イベントの対象の要素では、捕捉のリスナーが、登録の順に関係なく先に
// 呼ばれるので、断ったときに stopImmediatePropagation で enhance の送信処理を必ず止められる。
export function confirmSubmit(node: HTMLFormElement, message: string) {
	let currentMessage = message;
	const onSubmit = (event: SubmitEvent) => {
		if (confirm(currentMessage)) return;
		event.preventDefault();
		event.stopImmediatePropagation();
	};
	node.addEventListener('submit', onSubmit, { capture: true });
	return {
		update(newMessage: string) {
			currentMessage = newMessage;
		},
		destroy() {
			node.removeEventListener('submit', onSubmit, { capture: true });
		},
	};
}
