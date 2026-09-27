// リリースのノート (GitHub Releases の本文) を作る。前回のリリースから今回までの変更を、種類ごとに分け、
// 反映のときに確かめることを、変更されたファイルから判断して書く。I/O は持たない。git と gh の呼び出しは publish-release.ts が行う。

export interface Change {
	readonly type: string;
	readonly scope: string | null;
	readonly description: string;
	readonly pr: number | null;
	readonly breaking: boolean;
}

/** コミットの題 (type(scope): 説明 (#番号)) を分ける。決まりに合わない題は、その他として扱う */
export function parseChange(subject: string): Change {
	const match = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+?)(?: \(#(\d+)\))?$/.exec(subject.trim());
	if (!match) {
		return { type: 'other', scope: null, description: subject.trim(), pr: null, breaking: false };
	}
	return {
		type: match[1]!,
		scope: match[2] ?? null,
		description: match[4]!,
		pr: match[5] ? Number(match[5]) : null,
		breaking: match[3] === '!',
	};
}

export interface ReleaseNotesInput {
	/** oto-lab/funmary の形 */
	readonly repo: string;
	readonly version: string;
	readonly sha: string;
	readonly previousVersion: string | null;
	readonly previousSha: string | null;
	/** 前回から今回までに、main に入ったコミットの題 (新しいものが先) */
	readonly subjects: readonly string[];
	/** 前回から今回までに、変更されたファイルのパス */
	readonly changedFiles: readonly string[];
}

const SECTIONS: readonly { title: string; types: readonly string[] }[] = [
	{ title: '機能', types: ['feat'] },
	{ title: '不具合の修正', types: ['fix'] },
];

/** 題や説明に含まれる、Markdown として効いてしまう記号を、ただの文字にする */
function plain(text: string): string {
	return text.replace(/[\\`*_[\]<>#|]/g, (char) => `\\${char}`);
}

function line(change: Change, repo: string): string {
	const scope = change.scope ? ` (${plain(change.scope)})` : '';
	const link = change.pr ? ` ([#${change.pr}](https://github.com/${repo}/pull/${change.pr}))` : '';
	return `- ${plain(change.description)}${scope}${link}`;
}

/** 変更されたファイルから、反映のときに確かめることを判断する */
function checks(files: readonly string[]): string[] {
	const has = (predicate: (file: string) => boolean) => files.some(predicate);
	const items: string[] = [];
	if (has((f) => f.startsWith('packages/db/migrations/'))) {
		items.push(
			'DB のマイグレーションを含みます。起動するときに自動で適用され、その前にバックアップが取られます。',
		);
	}
	if (has((f) => f === '.env.example')) {
		items.push(
			'環境変数の見本 (.env.example) が変わりました。/etc/funmary/funmary.env に、足りない変数がないかを確かめてください。',
		);
	}
	if (has((f) => f.startsWith('deploy/'))) {
		items.push(
			'反映のスクリプトや unit (deploy/) が変わりました。update.sh が置き換えますが、systemd の unit が変わったときは、`systemctl daemon-reload` が要ることがあります。',
		);
	}
	if (has((f) => f === 'pnpm-lock.yaml' || f === 'pnpm-workspace.yaml')) {
		items.push('依存の更新を含みます。');
	}
	return items;
}

export function buildReleaseNotes(input: ReleaseNotesInput): string {
	const changes = input.subjects.filter((s) => !/^Merge\b/.test(s.trim())).map(parseChange);
	const out: string[] = [];

	if (input.previousVersion) {
		out.push(`${input.previousVersion} からの変更です。`);
	} else {
		out.push('最初のリリースです。');
	}

	const breaking = changes.filter((c) => c.breaking);
	if (breaking.length > 0) {
		out.push('## 互換性を壊す変更', breaking.map((c) => line(c, input.repo)).join('\n'));
	}

	if (changes.length === 0) {
		out.push('前回のリリースからの変更は、ありません (同じ内容を作り直したリリースです)。');
	}
	for (const section of SECTIONS) {
		const items = changes.filter((c) => section.types.includes(c.type));
		if (items.length === 0) continue;
		out.push(`## ${section.title}`, items.map((c) => line(c, input.repo)).join('\n'));
	}
	const others = changes.filter((c) => !SECTIONS.some((s) => s.types.includes(c.type)));
	if (others.length > 0) {
		out.push('## その他', others.map((c) => line(c, input.repo)).join('\n'));
	}

	const needed = checks(input.changedFiles);
	if (needed.length > 0) {
		out.push('## 反映のときに確かめること', needed.map((item) => `- ${item}`).join('\n'));
	}

	const footer = [`コミット: ${input.sha}`];
	if (input.previousSha) {
		footer.push(
			`[前回との差分](https://github.com/${input.repo}/compare/${input.previousSha}...${input.sha})`,
		);
	}
	out.push(footer.join(' / '));
	return `${out.join('\n\n')}\n`;
}
