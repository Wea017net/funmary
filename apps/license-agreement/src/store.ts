// 同意の記録 (D1 の agreements)。1 人 1 回で、同意した文面の版ごとに 1 行持つ。

export interface AgreementStore {
	hasAgreed(githubUserId: number, version: string): Promise<boolean>;
	/** 同意を記録する。同じ人の同じ版の記録が既にあれば、何もしない */
	record(entry: {
		readonly githubUserId: number;
		readonly githubLogin: string;
		readonly version: string;
		readonly agreedAt: Date;
	}): Promise<void>;
}

export function createD1Store(db: D1Database): AgreementStore {
	return {
		async hasAgreed(githubUserId, version) {
			const row = await db
				.prepare('SELECT 1 FROM agreements WHERE github_user_id = ? AND version = ?')
				.bind(githubUserId, version)
				.first();
			return row !== null;
		},
		async record(entry) {
			await db
				.prepare(
					'INSERT OR IGNORE INTO agreements (github_user_id, github_login, version, agreed_at) VALUES (?, ?, ?, ?)',
				)
				.bind(entry.githubUserId, entry.githubLogin, entry.version, entry.agreedAt.toISOString())
				.run();
		},
	};
}
