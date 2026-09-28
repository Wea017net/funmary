// ホーム画面に追加したアプリ (PWA) として開いているか。ブラウザでしか分からないので、onMount の中で呼ぶ。
export function isStandalone(): boolean {
	return (
		window.matchMedia('(display-mode: standalone)').matches ||
		('standalone' in navigator && navigator.standalone === true)
	);
}
