// 授業名を科目と照合する (設計書 9.1 の 7)。休講一覧などに書かれた授業名は、シラバスの科目名と表記が違うことがある。
// 完全一致、Unicode 正規化 (NFKC) 後の一致、"(旧:...)" を除いた一致、略称を言い換えた一致、類似度の順に試す。
// 類似度で選ぶのは、1 位が閾値を超え、かつ 2 位と十分な差があるときだけにする。
// 誤った科目に紐付けると、別の授業の休講を通知してしまうので、迷うときは決めずに人の確認へ回す。

export interface SubjectName {
	readonly id: number;
	readonly name: string;
}

export type MatchResult =
	| {
			readonly kind: 'matched';
			readonly subjectId: number;
			readonly method: 'exact' | 'normalized' | 'old-name-removed' | 'alias' | 'similarity';
	  }
	/** 決められない。管理画面に出して、手で紐付ける */
	| { readonly kind: 'ambiguous'; readonly reason: 'same-name' | 'close-candidates' }
	| { readonly kind: 'unmatched' };

/** 類似度の閾値。これ以上でなければ選ばない */
export const SIMILARITY_THRESHOLD = 0.8;
/** 1 位と 2 位の類似度の差。これ以上なければ決めない */
export const SIMILARITY_MARGIN = 0.1;

/**
 * NFKC で正規化し、空白を除き、小文字にする。
 * 波ダッシュ (〜) とチルダ、ハイフンと負号 (−) などは、文字コードの変換で入れ替わりやすいので、同じ文字にそろえる
 */
function normalize(text: string): string {
	return (
		text
			.normalize('NFKC')
			.replace(/[〜∼]/g, '~')
			.replace(/[‐-―−]/g, '-')
			.replace(/\s+/g, '')
			// 中黒の有無 (バーチャル・イングリッシュ と バーチャルイングリッシュ) は同じとみなす
			.replace(/・/g, '')
			.toLowerCase()
	);
}

/**
 * 授業時間割などで使われる略称と英語の名前を、シラバスの科目名の書き方に言い換える。
 * 例: "VEPⅠ1" は "バーチャル・イングリッシュ・プログラムⅠ1"、"CommunicationI1-A" は "コミュニケーションI1-A"
 */
const ALIASES: readonly [pattern: RegExp, replacement: string][] = [
	[/virtual\s*english\s*program/giu, 'バーチャル・イングリッシュ・プログラム'],
	[/VEP/gu, 'バーチャル・イングリッシュ・プログラム'],
	[/communication/giu, 'コミュニケーション'],
];

function expandAliases(text: string): string {
	return ALIASES.reduce(
		(current, [pattern, replacement]) => current.replace(pattern, replacement),
		text,
	);
}

/** 末尾の "(旧:...)" を除く。括弧と冒号は全角と半角の両方を受け付ける */
function removeOldName(text: string): string {
	return text.normalize('NFKC').replace(/\s*\(\s*旧\s*[:：][^)]*\)\s*$/u, '');
}

/** 末尾の番号 (I、II、III、数字など)。"線形代数 I" と "線形代数 II" は別の科目なので、類似度で取り違えないために使う */
function trailingNumber(text: string): string | undefined {
	return /(?:^|[^A-Za-z])([IVX]{1,4}|\d+)\s*$/.exec(text.normalize('NFKC'))?.[1];
}

/** 文字の 2 つ組 (bigram) の集合の Dice 係数。0 から 1 */
function similarity(a: string, b: string): number {
	if (a === b) return 1;
	if (a.length < 2 || b.length < 2) return 0;
	const grams = (text: string) => {
		const map = new Map<string, number>();
		for (let i = 0; i < text.length - 1; i++) {
			const gram = text.slice(i, i + 2);
			map.set(gram, (map.get(gram) ?? 0) + 1);
		}
		return map;
	};
	const ga = grams(a);
	const gb = grams(b);
	let overlap = 0;
	for (const [gram, count] of ga) overlap += Math.min(count, gb.get(gram) ?? 0);
	return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

function findUnique(
	subjects: readonly SubjectName[],
	predicate: (subject: SubjectName) => boolean,
): SubjectName | 'multiple' | undefined {
	const hits = subjects.filter(predicate);
	if (hits.length === 0) return undefined;
	return hits.length === 1 ? hits[0] : 'multiple';
}

/** どちらも末尾に番号があり、その番号が違う (別の科目) */
function differentNumber(a: string, b: string): boolean {
	const na = trailingNumber(removeOldName(a));
	const nb = trailingNumber(removeOldName(b));
	return na !== undefined && nb !== undefined && na !== nb;
}

export function matchLessonName(lessonName: string, subjects: readonly SubjectName[]): MatchResult {
	if (lessonName.trim() === '' || subjects.length === 0) return { kind: 'unmatched' };

	const expanded = expandAliases(lessonName);
	const steps: {
		method: 'exact' | 'normalized' | 'old-name-removed' | 'alias';
		test: (s: SubjectName) => boolean;
	}[] = [
		{ method: 'exact', test: (s) => s.name === lessonName },
		{ method: 'normalized', test: (s) => normalize(s.name) === normalize(lessonName) },
		{
			method: 'old-name-removed',
			test: (s) => normalize(removeOldName(s.name)) === normalize(removeOldName(lessonName)),
		},
		{
			method: 'alias',
			test: (s) =>
				expanded !== lessonName &&
				normalize(removeOldName(s.name)) === normalize(removeOldName(expanded)),
		},
	];
	for (const { method, test } of steps) {
		const hit = findUnique(subjects, test);
		if (hit === 'multiple') return { kind: 'ambiguous', reason: 'same-name' };
		if (hit) return { kind: 'matched', subjectId: hit.id, method };
	}

	const target = normalize(removeOldName(lessonName));
	const ranked = subjects
		.map((subject) => ({
			subject,
			score: differentNumber(lessonName, subject.name)
				? 0
				: similarity(target, normalize(removeOldName(subject.name))),
		}))
		.sort((a, b) => b.score - a.score);
	const [first, second] = ranked;
	if (!first || first.score < SIMILARITY_THRESHOLD) return { kind: 'unmatched' };
	if (second && first.score - second.score < SIMILARITY_MARGIN) {
		return { kind: 'ambiguous', reason: 'close-candidates' };
	}
	return { kind: 'matched', subjectId: first.subject.id, method: 'similarity' };
}

export interface LessonNamesMatch {
	readonly matched: readonly { readonly lessonName: string; readonly subjectId: number }[];
	/** 照合できなかった、または決められなかった名前。管理画面で手で紐付ける */
	readonly unmatched: readonly string[];
}

/**
 * 休講一覧などの授業名をまとめて照合する。管理者が手で紐付けた名前 (resolved) を先に使う。
 * 紐付けた科目が subjects にない (別の年度の科目など) ときは、通常の照合に回す
 */
export function matchLessonNames(
	lessonNames: readonly string[],
	subjects: readonly SubjectName[],
	resolved: ReadonlyMap<string, number>,
): LessonNamesMatch {
	const ids = new Set(subjects.map((subject) => subject.id));
	const matched: { lessonName: string; subjectId: number }[] = [];
	const unmatched: string[] = [];
	for (const lessonName of new Set(lessonNames)) {
		const manual = resolved.get(lessonName);
		if (manual !== undefined && ids.has(manual)) {
			matched.push({ lessonName, subjectId: manual });
			continue;
		}
		const result = matchLessonName(lessonName, subjects);
		if (result.kind === 'matched') matched.push({ lessonName, subjectId: result.subjectId });
		else unmatched.push(lessonName);
	}
	return { matched, unmatched };
}

/** 候補として出す、類似度の下限。照合で選ぶ閾値より低くし、人が選ぶ候補を広めに出す */
const CANDIDATE_THRESHOLD = 0.3;

/** 管理画面で、手で紐付けるときの候補。似ている順に返す */
export function rankCandidates<T extends SubjectName>(
	lessonName: string,
	subjects: readonly T[],
	limit: number,
): T[] {
	const target = normalize(removeOldName(lessonName));
	return subjects
		.map((subject) => ({
			subject,
			score: similarity(target, normalize(removeOldName(subject.name))),
		}))
		.filter((candidate) => candidate.score >= CANDIDATE_THRESHOLD)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map((candidate) => candidate.subject);
}
