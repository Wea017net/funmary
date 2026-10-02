-- ライセンスへの同意の記録。1 人 1 回で、同意した文面の版ごとに 1 行。GitHub のユーザー ID で見分ける (名前は変えられるため)
CREATE TABLE agreements (
	github_user_id INTEGER NOT NULL,
	github_login TEXT NOT NULL,
	version TEXT NOT NULL,
	agreed_at TEXT NOT NULL,
	PRIMARY KEY (github_user_id, version)
);
