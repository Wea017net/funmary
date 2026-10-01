// ライセンスへの同意の判断と、PR に送る文面 (Issue #235)。I/O は持たない。

/**
 * 同意してもらう文面の版。文面 (下の AGREEMENT_POINTS や、リポジトリのライセンス) を変えたら、日付を上げる。
 * 上げると、前の版に同意した人にも、もう一度同意を求める
 */
export const AGREEMENT_VERSION = '2026-10-02';

/** 検査の名前 (コミットの状態の context)。ruleset の必須の検査に、この名前を足す */
export const STATUS_CONTEXT = 'ライセンスへの同意';

/** Bot の案内のコメントを見分ける印 (画面には出ない) */
export const MARKER = '<!-- funmary-license-agreement -->';

/** 同意の画面に出す、同意してもらう内容 */
export const AGREEMENT_POINTS = [
	'Funmary に送る変更 (コード、文書など) を、BSD 3-Clause License と Apache License, Version 2.0 のデュアルライセンス (BSD-3-Clause OR Apache-2.0) で、追加の条件なしに提供します。',
	'送る変更は、自分が作ったもの、またはそのライセンスで提供してよいものです。',
	'Funmary のロゴとアイコンは、この 2 つのライセンスの対象外で、別の利用条件 (LICENSE-ASSETS) に従います。',
] as const;

/**
 * PR の作者に同意を求めなくてよいか。書き込み権限のある人 (author_association で判断する) と Bot は求めない。
 * author_association は GitHub の Webhook が付ける値 (OWNER、MEMBER、COLLABORATOR、CONTRIBUTOR、NONE など)
 */
export function isExempt(author: {
	readonly type: string;
	readonly association: string;
}): boolean {
	return author.type === 'Bot' || ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(author.association);
}

export function requestComment(login: string, agreeUrl: string): string {
	return [
		MARKER,
		`@${login} PR をありがとうございます。`,
		'',
		'Funmary では、外部の方から変更を受け取る前に、ライセンスへの同意をお願いしています (1 人 1 回です)。次のページで内容を確かめ、GitHub でログインして同意してください。同意すると、このコメントが書き換わり、検査「ライセンスへの同意」が通ります。',
		'',
		`- [ライセンスへの同意のページ](${agreeUrl})`,
	].join('\n');
}

export function confirmedComment(login: string): string {
	return [MARKER, `@${login} さんの、ライセンスへの同意を確かめました。ありがとうございます。`].join(
		'\n',
	);
}

/** owner/repo の形か (URL の引数から受け取る値を確かめる) */
export function isRepositoryName(value: string): boolean {
	return /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(value);
}
