// 利用規約への再同意を求めている間の、公開 API と MCP の答え。
// 同意するまで、すべての機能を止める。トークンの持ち主が同意していなければ、データを返さず、同意の画面の URL を知らせる。

export interface TermsGate {
	/** 同意を求める利用規約とプライバシーポリシーの版 (最終更新日) */
	readonly version: string;
	/** 同意の画面の URL (https://example.com/consent) */
	readonly consentUrl: string;
}

/** 購読 (ICS、RSS) の読み込み関数が、持ち主の同意を待っているときに返す印 */
export const TERMS_REQUIRED = 'terms-required' as const;

/** 公開 API が返すエラーの種類 (error の値)。クライアントは、この値で見分ける */
export const TERMS_NOT_ACCEPTED = 'terms_not_accepted';

/** 人と AI エージェントが読む説明。何が起きていて、何をすればよいかを書く */
export function termsRequiredMessage(consentUrl: string): string {
	return `Funmary の利用規約とプライバシーポリシーへの同意が必要です。同意するまで、すべての機能を停止しています。次のページでログインして、内容を確かめ、同意してください: ${consentUrl}`;
}

/** 公開 API の本文。HTTP の状態は 403 (トークンは正しいが、いまは使えない) */
export function termsRequiredBody(gate: TermsGate) {
	return {
		error: TERMS_NOT_ACCEPTED,
		message: termsRequiredMessage(gate.consentUrl),
		consentUrl: gate.consentUrl,
	};
}
