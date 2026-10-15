// Funmary の公開 API (/api/v1) の、型付きのクライアント。
// 型はサーバーの OpenAPI の定義から作った (src/generated/api.ts)。動いている間に使う依存は ofetch だけ。
import { createFetch, ofetch } from 'ofetch';
import type { paths } from './generated/api.ts';

export type { components, paths } from './generated/api.ts';

type Path = keyof paths;

/** 成功した応答 (200 か 201) の JSON の型 */
type ResponseOf<Operation> = Operation extends { responses: infer R }
	? R extends { 200: { content: { 'application/json': infer J } } }
		? J
		: R extends { 201: { content: { 'application/json': infer J } } }
			? J
			: never
	: never;

/** リクエストの本文 (JSON) の型 */
type BodyOf<Operation> = Operation extends {
	requestBody: { content: { 'application/json': infer J } };
}
	? J
	: never;

type Get<P extends Path> = paths[P] extends { get: infer Operation }
	? ResponseOf<Operation>
	: never;
type Post<P extends Path> = paths[P] extends { post: infer Operation } ? Operation : never;
type Put<P extends Path> = paths[P] extends { put: infer Operation } ? Operation : never;

export type CourseState = ResponseOf<Post<'/api/v1/courses'>>;
export type EventBody = BodyOf<Post<'/api/v1/events'>>;
export type EventResult = ResponseOf<Post<'/api/v1/events'>>;
/** 履修登録する科目の指し方。年度とシラバスの番号か、名前 */
export type CourseRef = BodyOf<Post<'/api/v1/courses'>>;
export type PersonalSlotBody = BodyOf<Put<'/api/v1/courses/{year}/{syllabusId}/personal-slots'>>;

/** サーバーが誤りを返したときと、通信できなかったときの例外。トークンは含めない */
export class FunmaryApiError extends Error {
	/** HTTP の状態。通信できなかったときは 0 */
	readonly status: number;
	/** サーバーが返した誤りの種類 (not_found、invalid_request、terms_not_accepted など)。通信の失敗は network_error */
	readonly code: string;
	/** サーバーが返した本文。JSON でなければ undefined */
	readonly body: unknown;

	constructor(init: { status: number; code: string; message: string; body?: unknown }) {
		super(init.message);
		this.name = 'FunmaryApiError';
		this.status = init.status;
		this.code = init.code;
		this.body = init.body;
	}
}

export interface FunmaryClientOptions {
	/** サーバーの URL。例: https://funmary.example.com (既定値は持たない) */
	baseURL: string;
	/** 設定画面で発行した、個人用のアクセストークン */
	token: string;
	/** 1 回の通信を待つ時間 (ミリ秒)。既定は 15 秒 */
	timeoutMs?: number;
	/** 429 (回数の制限) のときに、やり直す回数。既定は 2 回 */
	maxRetries?: number;
	fetch?: typeof fetch;
	/** 待つ処理。テストで差し替える */
	sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1000;
/** Retry-After が長すぎても、これ以上は待たない */
const MAX_RETRY_DELAY_MS = 60_000;

/** Retry-After (秒、または日時) を、待つ時間 (ミリ秒) にする */
function retryDelayMs(header: string | null, attempt: number, now: number): number {
	if (header !== null && /^\d+$/.test(header.trim())) {
		return Math.min(Number(header) * 1000, MAX_RETRY_DELAY_MS);
	}
	const date = header === null ? Number.NaN : Date.parse(header);
	if (!Number.isNaN(date)) return Math.min(Math.max(date - now, 0), MAX_RETRY_DELAY_MS);
	return DEFAULT_RETRY_DELAY_MS * (attempt + 1);
}

const segment = (value: string | number) => encodeURIComponent(String(value));

export function createFunmaryClient(options: FunmaryClientOptions) {
	const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
	const sleep =
		options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
	const base = options.fetch ? createFetch({ fetch: options.fetch }) : ofetch;
	const http = base.create({
		baseURL: options.baseURL,
		headers: { Authorization: `Bearer ${options.token}`, Accept: 'application/json' },
	});

	async function request<T>(
		method: 'GET' | 'POST' | 'PUT' | 'DELETE',
		path: string,
		extra: { query?: Record<string, string | number | undefined>; body?: unknown } = {},
	): Promise<T> {
		for (let attempt = 0; ; attempt += 1) {
			let response;
			try {
				response = await http.raw(path, {
					method,
					...(extra.query ? { query: extra.query } : {}),
					...(extra.body === undefined ? {} : { body: extra.body as Record<string, unknown> }),
					timeout,
					retry: false,
					ignoreResponseError: true,
				});
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				throw new FunmaryApiError({
					status: 0,
					code: 'network_error',
					message: `Funmary に接続できませんでした: ${reason}`,
				});
			}
			if (response.status === 429 && attempt < maxRetries) {
				await sleep(retryDelayMs(response.headers.get('retry-after'), attempt, Date.now()));
				continue;
			}
			if (!response.ok) {
				const body: unknown = response._data;
				const record =
					typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
				throw new FunmaryApiError({
					status: response.status,
					code: typeof record['error'] === 'string' ? record['error'] : `http_${response.status}`,
					message:
						typeof record['message'] === 'string'
							? record['message']
							: `Funmary が HTTP ${response.status} を返しました`,
					body: typeof body === 'object' ? body : undefined,
				});
			}
			return response._data as T;
		}
	}

	const range = (r: { start: string; end: string }) => ({ start: r.start, end: r.end });
	const course = (ref: { year: number; syllabusId: string }) =>
		`/api/v1/courses/${segment(ref.year)}/${segment(ref.syllabusId)}`;

	return {
		/** トークンの持ち主と、許された範囲 */
		me: () => request<Get<'/api/v1/me'>>('GET', '/api/v1/me'),
		/** 休講などのデータが新しいか */
		status: () => request<Get<'/api/v1/status'>>('GET', '/api/v1/status'),
		lessons: (r: { start: string; end: string }) =>
			request<Get<'/api/v1/lessons'>>('GET', '/api/v1/lessons', { query: range(r) }),
		nextLesson: () => request<Get<'/api/v1/lessons/next'>>('GET', '/api/v1/lessons/next'),
		/** 授業と、振替授業日、全学の休講日、祝日 */
		timetable: (r: { start: string; end: string }) =>
			request<Get<'/api/v1/timetable'>>('GET', '/api/v1/timetable', { query: range(r) }),
		/** 週の曜日と時限の格子。date を省くと今週 */
		week: (query: { date?: string } = {}) =>
			request<Get<'/api/v1/timetable/week'>>('GET', '/api/v1/timetable/week', { query }),
		periods: () => request<Get<'/api/v1/periods'>>('GET', '/api/v1/periods'),
		academicCalendar: (query: { year?: number } = {}) =>
			request<Get<'/api/v1/academic-calendar'>>('GET', '/api/v1/academic-calendar', { query }),
		/** 休講、補講、教室変更 */
		changes: (r: { start: string; end: string }) =>
			request<Get<'/api/v1/changes'>>('GET', '/api/v1/changes', { query: range(r) }),

		courses: {
			list: () => request<Get<'/api/v1/courses'>>('GET', '/api/v1/courses'),
			/** 履修登録する。登録済みなら、何も変えずに今の状態を返す */
			register: (ref: CourseRef) => request<CourseState>('POST', '/api/v1/courses', { body: ref }),
			/** 履修登録を取り消す。自分だけの曜日と時限と略称は残る */
			unregister: (ref: { year: number; syllabusId: string }) =>
				request<CourseState>('DELETE', course(ref)),
			/** 自分だけに使う曜日と時限を足す (同じ曜日と時限があれば、教室を上書きする) */
			setPersonalSlot: (ref: { year: number; syllabusId: string }, slot: PersonalSlotBody) =>
				request<CourseState>('PUT', `${course(ref)}/personal-slots`, { body: slot }),
			removePersonalSlot: (
				ref: { year: number; syllabusId: string },
				slot: { weekday: number; period: number },
			) =>
				request<CourseState>(
					'DELETE',
					`${course(ref)}/personal-slots/${segment(slot.weekday)}/${segment(slot.period)}`,
				),
			/** 時間割に出す、自分だけの略称。空にすると、正式名称を使う */
			setAbbreviation: (ref: { year: number; syllabusId: string }, abbreviation: string) =>
				request<CourseState>('PUT', `${course(ref)}/abbreviation`, { body: { abbreviation } }),
		},

		subjects: {
			search: (
				query: {
					q?: string | undefined;
					year?: number | undefined;
					term?: string | undefined;
				} = {},
			) => request<Get<'/api/v1/subjects'>>('GET', '/api/v1/subjects', { query }),
			get: (ref: { year: number; syllabusId: string }) =>
				request<Get<'/api/v1/subjects/{year}/{syllabusId}'>>(
					'GET',
					`/api/v1/subjects/${segment(ref.year)}/${segment(ref.syllabusId)}`,
				),
			sessions: (ref: { year: number; syllabusId: string }) =>
				request<Get<'/api/v1/subjects/{year}/{syllabusId}/sessions'>>(
					'GET',
					`/api/v1/subjects/${segment(ref.year)}/${segment(ref.syllabusId)}/sessions`,
				),
		},

		events: {
			list: (r: { start: string; end: string }) =>
				request<Get<'/api/v1/events'>>('GET', '/api/v1/events', { query: range(r) }),
			get: (id: number) =>
				request<Get<'/api/v1/events/{id}'>>('GET', `/api/v1/events/${segment(id)}`),
			create: (body: EventBody) => request<EventResult>('POST', '/api/v1/events', { body }),
			/** 送った内容に置き換える (送らなかった項目は、空になる) */
			replace: (id: number, body: EventBody) =>
				request<EventResult>('PUT', `/api/v1/events/${segment(id)}`, { body }),
			delete: (id: number) => request<undefined>('DELETE', `/api/v1/events/${segment(id)}`),
		},

		notifications: {
			list: (
				query: {
					kinds?: string | undefined;
					since?: string | undefined;
					afterId?: number | undefined;
					limit?: number | undefined;
				} = {},
			) => request<Get<'/api/v1/notifications'>>('GET', '/api/v1/notifications', { query }),
			markRead: (id: number) =>
				request<ResponseOf<Post<'/api/v1/notifications/{id}/read'>>>(
					'POST',
					`/api/v1/notifications/${segment(id)}/read`,
				),
			markAllRead: () =>
				request<ResponseOf<Post<'/api/v1/notifications/read'>>>(
					'POST',
					'/api/v1/notifications/read',
				),
		},

		bus: {
			stops: () => request<Get<'/api/v1/bus/stops'>>('GET', '/api/v1/bus/stops'),
			stop: (stopId: string, query: { generation?: number } = {}) =>
				request<Get<'/api/v1/bus/stops/{stopId}'>>('GET', `/api/v1/bus/stops/${segment(stopId)}`, {
					query,
				}),
			next: (query: { stopId?: string; limit?: number } = {}) =>
				request<Get<'/api/v1/bus/next'>>('GET', '/api/v1/bus/next', { query }),
		},
	};
}

export type FunmaryClient = ReturnType<typeof createFunmaryClient>;
