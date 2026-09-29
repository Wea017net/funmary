// クリップボードへのコピーと、「コピーしました」の一時的な表示をまとめる。
// コピーしたままだと、あとで見た人が「まだコピーできていないのでは」と誤解するので、しばらくしたら自動で消す
const SHOWN_MS = 2000;

export interface CopyState {
	/** 直前のコピーが成功して、まだ表示している間だけ true */
	readonly copied: boolean;
	/** クリップボードに書き込む。失敗したら false を返す (呼び出し側で、欄を選ぶなどの代わりの案内をする) */
	copy(text: string): Promise<boolean>;
	/** 表示をすぐに消す (別の操作をしたときなど) */
	reset(): void;
}

export function createCopyState(): CopyState {
	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	function reset() {
		clearTimeout(timer);
		copied = false;
	}

	return {
		get copied() {
			return copied;
		},
		async copy(text) {
			clearTimeout(timer);
			try {
				await navigator.clipboard.writeText(text);
			} catch {
				copied = false;
				return false;
			}
			copied = true;
			timer = setTimeout(() => {
				copied = false;
			}, SHOWN_MS);
			return true;
		},
		reset,
	};
}
