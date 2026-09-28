// DB のスキーマ。変えたら `pnpm --filter @funmary/db generate` でマイグレーションを作る。
// マイグレーションは列やテーブルを足す方向だけにし、1 つ前の版のアプリがそのまま動くようにする。
import { sql } from 'drizzle-orm';
import {
	type AnySQLiteColumn,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/** 作成時刻。ミリ秒の UNIX 時刻で持つ */
const createdAt = () =>
	integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(sql`(unixepoch('subsec') * 1000)`);

// ---------------------------------------------------------------------------
// アカウント

export const users = sqliteTable('users', {
	/** 推測できない乱数の ID */
	id: text('id').primaryKey(),
	email: text('email').notNull().unique(),
	/** Google の ID トークンの sub */
	googleSub: text('google_sub').notNull().unique(),
	name: text('name'),
	role: text('role', { enum: ['user', 'admin'] })
		.notNull()
		.default('user'),
	status: text('status', { enum: ['active', 'suspended'] })
		.notNull()
		.default('active'),
	invitedBy: text('invited_by').references((): AnySQLiteColumn => users.id, {
		onDelete: 'set null',
	}),
	inviteCodeId: integer('invite_code_id').references((): AnySQLiteColumn => inviteCodes.id, {
		onDelete: 'set null',
	}),
	createdAt: createdAt(),
	lastLoginAt: integer('last_login_at', { mode: 'timestamp_ms' }),
});

export const sessions = sqliteTable(
	'sessions',
	{
		/** セッション ID の SHA-256。ID そのものは Cookie にだけある */
		idHash: text('id_hash').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		createdAt: createdAt(),
		lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
	},
	(table) => [index('sessions_user_id').on(table.userId)],
);

export const inviteCodes = sqliteTable('invite_codes', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	/** 招待コードの SHA-256 */
	codeHash: text('code_hash').notNull().unique(),
	maxUses: integer('max_uses').notNull().default(1),
	usedCount: integer('used_count').notNull().default(0),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
	createdBy: text('created_by').references((): AnySQLiteColumn => users.id, {
		onDelete: 'set null',
	}),
	/** 誰に渡したかなどのメモ */
	note: text('note'),
	createdAt: createdAt(),
	revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
});

/**
 * 利用者ごとに付けた権限 (例: invite:create は招待コードの発行)。
 * 将来ロールを足すときは、ロールを権限の組として定義し、この表は個別に付けた分だけを持つ
 */
export const userPermissions = sqliteTable(
	'user_permissions',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		permission: text('permission', { enum: ['invite:create'] }).notNull(),
		grantedBy: text('granted_by').references((): AnySQLiteColumn => users.id, {
			onDelete: 'set null',
		}),
		grantedAt: integer('granted_at', { mode: 'timestamp_ms' }).notNull(),
	},
	(table) => [primaryKey({ columns: [table.userId, table.permission] })],
);

// ---------------------------------------------------------------------------
// 科目と履修

export const subjects = sqliteTable(
	'subjects',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		academicYear: integer('academic_year').notNull(),
		/** シラバスの番号 */
		syllabusId: text('syllabus_id').notNull(),
		name: text('name').notNull(),
		teacher: text('teacher'),
		credits: integer('credits'),
		/** @funmary/core の Term */
		term: text('term').notNull(),
		/** 対象学年、必修か選択かなど、シラバスの表の項目 */
		attributes: text('attributes', { mode: 'json' }).$type<Record<string, string>>(),
		/** 授業の概要、到達目標、授業計画などの本文 */
		syllabus: text('syllabus', { mode: 'json' }).$type<Record<string, string>>(),
		syllabusUrl: text('syllabus_url'),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
		/** syllabus は公開シラバスから取り込んだもの、user はシラバスにない授業として利用者か管理者が足したもの */
		source: text('source', { enum: ['syllabus', 'user'] })
			.notNull()
			.default('syllabus'),
		/** 足した人 (source が user のとき) */
		createdBy: text('created_by').references((): AnySQLiteColumn => users.id, {
			onDelete: 'set null',
		}),
	},
	(table) => [uniqueIndex('subjects_year_syllabus').on(table.academicYear, table.syllabusId)],
);

export const timetableSlots = sqliteTable(
	'timetable_slots',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		subjectId: integer('subject_id')
			.notNull()
			.references(() => subjects.id, { onDelete: 'cascade' }),
		/** ISO 8601 の曜日。1 が月曜 */
		weekday: integer('weekday').notNull(),
		period: integer('period').notNull(),
		room: text('room'),
		/**
		 * 枠をどこから得たか。大学から自動では取れないので、利用者どうしで登録している。
		 * portal (利用者がポータルの時間割から取り込んだ)、manual (利用者が手で入力した)、pdf (管理者が時間割の PDF から取り込んだ)、admin (管理者が直した)
		 */
		source: text('source', { enum: ['portal', 'manual', 'pdf', 'admin'] })
			.notNull()
			.default('manual'),
		/** 登録した利用者。退会したら null */
		createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
	},
	(table) => [
		uniqueIndex('timetable_slots_unique').on(table.subjectId, table.weekday, table.period),
	],
);

export const courseRegistrations = sqliteTable(
	'course_registrations',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		subjectId: integer('subject_id')
			.notNull()
			.references(() => subjects.id, { onDelete: 'cascade' }),
		hopeCourseUrl: text('hope_course_url'),
		/** 欠席の上限。利用者が決める */
		absenceLimit: integer('absence_limit'),
		createdAt: createdAt(),
	},
	(table) => [
		primaryKey({ columns: [table.userId, table.subjectId] }),
		index('course_registrations_subject').on(table.subjectId),
	],
);

// ---------------------------------------------------------------------------
// 休講など

export const classChanges = sqliteTable(
	'class_changes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		kind: text('kind', { enum: ['cancellation', 'makeup', 'roomChange'] }).notNull(),
		/** 科目と照合できるまでは null */
		subjectId: integer('subject_id').references(() => subjects.id, { onDelete: 'set null' }),
		/** ポータルの表記のままの授業名 */
		lessonName: text('lesson_name').notNull(),
		date: text('date').notNull(),
		period: integer('period').notNull(),
		teacher: text('teacher'),
		campus: text('campus'),
		/** 補講の教室、または教室変更の移動先 */
		room: text('room'),
		/** 教室変更の移動元 */
		fromRoom: text('from_room'),
		comment: text('comment'),
		makeupPlan: text('makeup_plan', { enum: ['planned', 'none', 'undecided'] }),
		firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
		lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
		/** 一覧から続けて消えた回数。2 回で取り消しとみなす */
		missingCount: integer('missing_count').notNull().default(0),
		withdrawnAt: integer('withdrawn_at', { mode: 'timestamp_ms' }),
	},
	(table) => [
		uniqueIndex('class_changes_unique').on(table.kind, table.date, table.period, table.lessonName),
		index('class_changes_subject_date').on(table.subjectId, table.date),
	],
);

export const unmatchedLessons = sqliteTable(
	'unmatched_lessons',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		academicYear: integer('academic_year').notNull(),
		lessonName: text('lesson_name').notNull(),
		firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
		lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
		/** 管理者が「科目にしない」とした時刻。集会など、科目でない名前を一覧から外す */
		ignoredAt: integer('ignored_at', { mode: 'timestamp_ms' }),
		/** 管理者が手で紐付けた科目 */
		resolvedSubjectId: integer('resolved_subject_id').references(() => subjects.id, {
			onDelete: 'set null',
		}),
	},
	(table) => [uniqueIndex('unmatched_lessons_unique').on(table.academicYear, table.lessonName)],
);

/** 利用者が自分の時間割に足す予定 (Issue #144)。繰り返しは RRULE の文字列で持つ */
export const userEvents = sqliteTable(
	'user_events',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		ownerId: text('owner_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		location: text('location'),
		notes: text('notes'),
		/** 始まりの日と、終わりの日 (この日を含む)。単発なら同じ */
		startDate: text('start_date').notNull(),
		endDate: text('end_date').notNull(),
		timeKind: text('time_kind', { enum: ['allDay', 'time', 'period'] }).notNull(),
		startTime: text('start_time'),
		endTime: text('end_time'),
		startPeriod: integer('start_period'),
		endPeriod: integer('end_period'),
		/** RFC 5545 の RRULE の値。繰り返さないなら null */
		rrule: text('rrule'),
		/** 繰り返しから除く日 ("YYYY-MM-DD" の配列) */
		excludedDates: text('excluded_dates', { mode: 'json' }).$type<string[]>().notNull().default([]),
		/** 公開範囲。private は本人だけ、link は共有のリンクを知っている人、public はログインしている全員 */
		visibility: text('visibility', { enum: ['private', 'link', 'public'] })
			.notNull()
			.default('private'),
		/** 限定公開 (link) の共有のリンクの値。限定公開でなければ null。再発行すると変わる */
		shareToken: text('share_token').unique(),
		createdAt: createdAt(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
	},
	(table) => [
		index('user_events_owner').on(table.ownerId, table.startDate),
		index('user_events_public').on(table.visibility),
	],
);

/** ほかの人の予定を、自分の時間割に加えたもの (Issue #145)。持ち主が直すと、加えた人にも反映される */
export const eventSubscriptions = sqliteTable(
	'event_subscriptions',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		eventId: integer('event_id')
			.notNull()
			.references(() => userEvents.id, { onDelete: 'cascade' }),
		createdAt: createdAt(),
	},
	(table) => [primaryKey({ columns: [table.userId, table.eventId] })],
);

// ---------------------------------------------------------------------------
// 暦

/** 値の出どころ */
const sourceKinds = ['auto', 'manual', 'estimated'] as const;

export const academicTerms = sqliteTable(
	'academic_terms',
	{
		academicYear: integer('academic_year').notNull(),
		term: text('term').notNull(),
		start: text('start').notNull(),
		end: text('end').notNull(),
		source: text('source', { enum: sourceKinds }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
	},
	(table) => [primaryKey({ columns: [table.academicYear, table.term] })],
);

export const academicDays = sqliteTable(
	'academic_days',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		date: text('date').notNull(),
		/** 振替授業日、全学の休講日、行事 */
		kind: text('kind', { enum: ['substitute', 'noClass', 'event'] }).notNull(),
		/** 振替授業日に行う曜日 */
		weekday: integer('weekday'),
		label: text('label'),
		source: text('source', { enum: sourceKinds }).notNull(),
	},
	(table) => [uniqueIndex('academic_days_unique').on(table.date, table.kind)],
);

export const holidays = sqliteTable('holidays', {
	date: text('date').primaryKey(),
	name: text('name').notNull(),
	source: text('source', { enum: ['cabinetOffice', 'bundled', 'estimated'] }).notNull(),
});

// ---------------------------------------------------------------------------
// 利用者の記録

export const absences = sqliteTable(
	'absences',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		subjectId: integer('subject_id')
			.notNull()
			.references(() => subjects.id, { onDelete: 'cascade' }),
		date: text('date').notNull(),
		period: integer('period').notNull(),
		createdAt: createdAt(),
	},
	(table) => [
		uniqueIndex('absences_unique').on(table.userId, table.subjectId, table.date, table.period),
	],
);

/** ICS とフィードの URL のトークン */
export const feedTokens = sqliteTable(
	'feed_tokens',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: ['calendar', 'feed'] }).notNull(),
		tokenHash: text('token_hash').notNull().unique(),
		/** 載せる予定や通知の種類など */
		options: text('options', { mode: 'json' }).$type<Record<string, unknown>>(),
		createdAt: createdAt(),
		lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
		revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
	},
	(table) => [index('feed_tokens_user').on(table.userId)],
);

export const shares = sqliteTable(
	'shares',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		tokenHash: text('token_hash').notNull().unique(),
		visibility: text('visibility', { enum: ['anyone', 'signedIn'] }).notNull(),
		showRooms: integer('show_rooms', { mode: 'boolean' }).notNull().default(true),
		showChanges: integer('show_changes', { mode: 'boolean' }).notNull().default(true),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
		createdAt: createdAt(),
		revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
	},
	(table) => [index('shares_user').on(table.userId)],
);

export const hopeCalendars = sqliteTable('hope_calendars', {
	userId: text('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	/** HOPE の書き出しの URL。本人用のトークンを含むので暗号化する */
	urlEncrypted: text('url_encrypted').notNull(),
	etag: text('etag'),
	lastModified: text('last_modified'),
	lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp_ms' }),
	consecutiveFailures: integer('consecutive_failures').notNull().default(0),
});

export const hopeEvents = sqliteTable(
	'hope_events',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		uid: text('uid').notNull(),
		title: text('title').notNull(),
		dueAt: integer('due_at', { mode: 'timestamp_ms' }).notNull(),
		courseName: text('course_name'),
		url: text('url'),
	},
	(table) => [uniqueIndex('hope_events_unique').on(table.userId, table.uid)],
);

// ---------------------------------------------------------------------------
// 通知

export const notifications = sqliteTable(
	'notifications',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		kind: text('kind').notNull(),
		title: text('title').notNull(),
		body: text('body'),
		/** 押したときに開く画面のパス */
		link: text('link'),
		subjectId: integer('subject_id').references(() => subjects.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		readAt: integer('read_at', { mode: 'timestamp_ms' }),
	},
	(table) => [index('notifications_user_created').on(table.userId, table.createdAt)],
);

export const channels = sqliteTable(
	'channels',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: ['discord', 'push', 'email'] }).notNull(),
		/** Webhook の URL やプッシュ通知の購読情報。暗号化する */
		configEncrypted: text('config_encrypted').notNull(),
		label: text('label'),
		/** このチャネルに送る通知の種類 */
		notificationKinds: text('notification_kinds', { mode: 'json' }).$type<string[]>(),
		status: text('status', { enum: ['active', 'disabled'] })
			.notNull()
			.default('active'),
		disabledReason: text('disabled_reason'),
		createdAt: createdAt(),
	},
	(table) => [index('channels_user').on(table.userId)],
);

export const deliveries = sqliteTable(
	'deliveries',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		notificationId: integer('notification_id')
			.notNull()
			.references(() => notifications.id, { onDelete: 'cascade' }),
		channelId: integer('channel_id')
			.notNull()
			.references(() => channels.id, { onDelete: 'cascade' }),
		status: text('status', { enum: ['pending', 'sent', 'failed'] })
			.notNull()
			.default('pending'),
		attempts: integer('attempts').notNull().default(0),
		nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp_ms' }),
		lastError: text('last_error'),
		sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
	},
	(table) => [
		// 同じ通知が同じチャネルに二重に届かないようにする
		uniqueIndex('deliveries_unique').on(table.notificationId, table.channelId),
		index('deliveries_pending').on(table.status, table.nextAttemptAt),
	],
);

// ---------------------------------------------------------------------------
// 運用

/** 取得元の見張り */
export const sourceStatus = sqliteTable('source_status', {
	source: text('source').primaryKey(),
	lastSuccessAt: integer('last_success_at', { mode: 'timestamp_ms' }),
	lastAttemptAt: integer('last_attempt_at', { mode: 'timestamp_ms' }),
	consecutiveFailures: integer('consecutive_failures').notNull().default(0),
	nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp_ms' }),
	lastError: text('last_error'),
	/** 前回取得した内容のハッシュ。同じなら解析を省く */
	contentHash: text('content_hash'),
});

/** 時限の時刻など、管理画面で変える値 */
export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value', { mode: 'json' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const jobRuns = sqliteTable(
	'job_runs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		job: text('job').notNull(),
		startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
		finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
		status: text('status', { enum: ['running', 'succeeded', 'failed', 'skipped'] }).notNull(),
		message: text('message'),
	},
	(table) => [index('job_runs_job_started').on(table.job, table.startedAt)],
);
