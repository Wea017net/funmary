// 利用規約とプライバシーポリシーの最終更新日。ページに出す日付と、再同意を求める版が、同じ値から決まる。
// どちらかの文書の中身を変えたら、ここの日付を書き換える。全員に、もう一度同意を求める。
import { currentTermsVersion } from '@funmary/core';

/** 利用規約の最終更新日 (YYYY-MM-DD) */
export const TERMS_UPDATED_AT = '2026-10-03';

/** プライバシーポリシーの最終更新日 (YYYY-MM-DD) */
export const PRIVACY_UPDATED_AT = '2026-10-03';

/** 同意を求める版。2 つの最終更新日のうち、新しいほう */
export const CURRENT_TERMS_VERSION = currentTermsVersion(TERMS_UPDATED_AT, PRIVACY_UPDATED_AT);
