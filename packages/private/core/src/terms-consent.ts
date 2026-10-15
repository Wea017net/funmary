// 利用規約とプライバシーポリシーへの同意。規約のどちらかの最終更新日が変わったら、全員がもう一度同意する。
// 版は、2 つの最終更新日 (YYYY-MM-DD) のうち、新しいほうの日付にする。日付は文字列のまま比べられる。
// I/O を持たない、画面、公開 API、MCP、Discord が同じ判定を使うための関数だけを置く。

/** 2 つの文書の最終更新日から、同意を求める版を決める (新しいほうの日付) */
export function currentTermsVersion(termsUpdatedAt: string, privacyUpdatedAt: string): string {
	return termsUpdatedAt >= privacyUpdatedAt ? termsUpdatedAt : privacyUpdatedAt;
}

/** 利用者が、いまの版に同意しているか。一度も同意していなければ false。古い版への同意は、今の版の同意ではない */
export function hasAcceptedTerms(acceptedVersion: string | null, currentVersion: string): boolean {
	return acceptedVersion === currentVersion;
}
