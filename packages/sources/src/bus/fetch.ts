// バスの時刻表の API (契約は hakobus-types の OpenAPI) から、停留所の一覧と発車表を取得する。
// 外部への通信は、定期処理からだけ呼ぶ。fetch は差し替えられる (テストと、通信の制御のため)。
import type { BusCatalog, BusStopTimetable } from '@funmary/core';
import desktopUserAgents from 'top-user-agents/desktop';
import * as v from 'valibot';

/** 作者の判断で、一般的なブラウザのものに合わせる */
const USER_AGENT = desktopUserAgents[0]!;
const TIMEOUT_MS = 15_000;

const GenerationSchema = v.object({
	code: v.number(),
	name: v.string(),
	current: v.boolean(),
});
const StopSummarySchema = v.object({ id: v.string(), name: v.string() });

export const BusStopListSchema = v.object({
	schemaVersion: v.literal(2),
	generatedAt: v.string(),
	generations: v.array(GenerationSchema),
	stops: v.array(StopSummarySchema),
});

const DepartureSchema = v.object({
	time: v.pipe(v.string(), v.regex(/^[0-9]{2}:[0-5][0-9]$/)),
	routes: v.array(v.string()),
	via: v.optional(v.string()),
	destination: v.optional(v.string()),
	marks: v.optional(v.array(v.string()), []),
});

const PlatformTimetableSchema = v.object({
	platformNo: v.number(),
	platformName: v.optional(v.string()),
	day: v.picklist(['weekday', 'holiday']),
	notes: v.array(v.string()),
	departures: v.array(DepartureSchema),
});

export const BusStopTimetableSchema = v.object({
	schemaVersion: v.literal(2),
	generatedAt: v.string(),
	fetchedAt: v.optional(v.string()),
	generation: GenerationSchema,
	stop: StopSummarySchema,
	timetables: v.array(PlatformTimetableSchema),
});

export interface FetchBusDeps {
	readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
	/** BUS_API_BASE_URL */
	readonly baseUrl: string;
	/** 前回の取得で得た ETag */
	readonly etag?: string | null;
}

export type FetchBusResult<T> =
	| { readonly kind: 'updated'; readonly body: T; readonly etag: string | null }
	| { readonly kind: 'not-modified' }
	/** サーバーに、まだ時刻表がない (503) */
	| { readonly kind: 'not-ready' }
	/** サーバーに、その停留所か版がない (404) */
	| { readonly kind: 'not-found' }
	| { readonly kind: 'failed'; readonly message: string };

/** 例外は投げず、結果として返す。1 つの取得元の失敗を、ほかの処理に波及させないため */
async function getJson<T>(
	deps: FetchBusDeps,
	path: string,
	schema: v.GenericSchema<unknown, T>,
	label: string,
): Promise<FetchBusResult<T>> {
	const headers = new Headers({ 'User-Agent': USER_AGENT, Accept: 'application/json' });
	if (deps.etag) headers.set('If-None-Match', deps.etag);
	try {
		const response = await deps.fetch(`${deps.baseUrl.replace(/\/+$/, '')}${path}`, {
			headers,
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (response.status === 304) return { kind: 'not-modified' };
		if (response.status === 503) return { kind: 'not-ready' };
		if (response.status === 404) return { kind: 'not-found' };
		if (!response.ok) {
			return { kind: 'failed', message: `${label}が HTTP ${response.status} を返しました` };
		}
		const parsed = v.safeParse(schema, await response.json());
		if (!parsed.success) {
			return {
				kind: 'failed',
				message: `${label}の形が契約と違います: ${parsed.issues[0]?.message ?? ''}`,
			};
		}
		return { kind: 'updated', body: parsed.output, etag: response.headers.get('etag') };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return { kind: 'failed', message: `${label}を取得できませんでした: ${reason}` };
	}
}

export type FetchBusStopListResult =
	| { readonly kind: 'updated'; readonly list: BusCatalog; readonly etag: string | null }
	| Exclude<FetchBusResult<never>, { kind: 'updated' }>;

export async function fetchBusStopList(deps: FetchBusDeps): Promise<FetchBusStopListResult> {
	const result = await getJson(deps, '/v1/stops', BusStopListSchema, 'バスの停留所の一覧');
	return result.kind === 'updated'
		? {
				kind: 'updated',
				list: {
					generatedAt: result.body.generatedAt,
					generations: result.body.generations,
					stops: result.body.stops,
				},
				etag: result.etag,
			}
		: result;
}

export interface FetchBusStopTimetableDeps extends FetchBusDeps {
	readonly stopId: string;
	/** 省くと、サーバーが「いま使われている版」を返す */
	readonly generation?: number;
}

export type FetchBusStopTimetableResult =
	| { readonly kind: 'updated'; readonly timetable: BusStopTimetable; readonly etag: string | null }
	| Exclude<FetchBusResult<never>, { kind: 'updated' }>;

export async function fetchBusStopTimetable(
	deps: FetchBusStopTimetableDeps,
): Promise<FetchBusStopTimetableResult> {
	const query = deps.generation === undefined ? '' : `?generation=${deps.generation}`;
	const result = await getJson(
		deps,
		`/v1/stops/${encodeURIComponent(deps.stopId)}${query}`,
		BusStopTimetableSchema,
		`バス停 ${deps.stopId} の発車表`,
	);
	return result.kind === 'updated'
		? {
				kind: 'updated',
				timetable: {
					generatedAt: result.body.generatedAt,
					fetchedAt: result.body.fetchedAt,
					generation: result.body.generation,
					stop: result.body.stop,
					timetables: result.body.timetables,
				},
				etag: result.etag,
			}
		: result;
}
