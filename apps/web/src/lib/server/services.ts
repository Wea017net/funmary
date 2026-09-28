// 画面のサーバー側の処理 (load、action) が使う部品。起動時に hooks.server.ts の init が 1 回だけ入れる。
import type {
	AcademicCalendarStore,
	AuthStore,
	ClassChangeStore,
	CourseStore,
	FeedTokenStore,
	HolidayStore,
	SettingsStore,
	StoredJobRunStore,
	SourceHealthStore,
	SubjectStore,
	UnmatchedLessonStore,
	UserEventStore,
} from '@funmary/db';
import type { DiscordBot, DiscordLayout } from '@funmary/notify';
import type { BuildInfo } from './build-info.ts';
import type { TimetableSources } from './user-timetable.ts';

export interface Services {
	/** 利用者、招待コード、利用者の権限 */
	readonly auth: AuthStore;
	/** 管理画面で変える設定 (招待コードを発行できる人など) */
	readonly settings: SettingsStore;
	/** 管理用の Discord の Bot と、チャンネルとロールの配置 (設計書 14.9)。Bot は設定されていなければ null */
	readonly discord: {
		readonly bot: DiscordBot | null;
		layout(): DiscordLayout;
		saveLayout(layout: DiscordLayout): void;
		/** Bot のオンライン表示 (Gateway につなぐ)。available は本番で、送信を止めていないときだけ true */
		readonly presence: {
			readonly available: boolean;
			enabled(): boolean;
			setEnabled(enabled: boolean): void;
		};
	};
	readonly courses: CourseStore;
	/** 利用者が自分の時間割に足した予定 (持ち主だけが読み書きできる) */
	readonly userEvents: UserEventStore;
	readonly subjects: SubjectStore;
	readonly classChanges: ClassChangeStore;
	readonly unmatchedLessons: UnmatchedLessonStore;
	readonly academicCalendar: AcademicCalendarStore;
	readonly holidays: HolidayStore;
	readonly sourceHealth: SourceHealthStore;
	readonly jobRuns: StoredJobRunStore;
	readonly estimateHolidays: TimetableSources['estimateHolidays'];
	/** 動いているアプリの版。手元の開発では null */
	readonly build: BuildInfo | null;
	/** カレンダー購読の URL のトークン */
	readonly feedTokens: FeedTokenStore;
	/** 新規登録の方式 (設計書 8.2)。紹介の画面の案内に使う */
	readonly registration: 'invite' | 'open' | 'closed';
	/** 公開 URL の origin (ブックマークレットの戻り先に使う) */
	readonly origin: string;
	/** 管理者への知らせ。秘密の値を含めない */
	readonly alertAdmin: (alert: {
		severity: 'info' | 'warn' | 'error';
		title: string;
		message?: string;
		key?: string;
	}) => Promise<unknown>;
}

let services: Services | undefined;

export function setServices(value: Services): void {
	services = value;
}

export function getServices(): Services {
	if (!services) throw new Error('サーバーの準備が終わっていません');
	return services;
}
