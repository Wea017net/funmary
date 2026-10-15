// バスの時刻表の保存。外部の API から取得した内容を、そのまま (検査を通ったものだけ) 写して持つ。
// 画面、API、Discord は、ここに保存した内容だけを読み、外部には接続しない。
import type { BusCatalog, BusStopTimetable } from '@funmary/core';
import { and, eq, notInArray } from 'drizzle-orm';
import type { Database } from './database.ts';
import { busCatalog, busStopTimetables } from './schema.ts';

const CATALOG_ID = 1;

export interface StoredBusCatalog {
	readonly catalog: BusCatalog;
	readonly etag: string | null;
	/** 外部の API に最後に確かめた日時 (内容が変わっていなかった確認も含む) */
	readonly checkedAt: Date;
}

export interface StoredBusTimetable {
	readonly timetable: BusStopTimetable;
	readonly etag: string | null;
	readonly checkedAt: Date;
}

export interface BusStore {
	getCatalog(): StoredBusCatalog | null;
	saveCatalog(catalog: BusCatalog, etag: string | null, at: Date): void;
	/** 内容が変わっていなかったとき、確かめた日時だけを更新する */
	touchCatalog(at: Date): void;
	getTimetable(stopId: string, generation: number): StoredBusTimetable | null;
	saveTimetable(timetable: BusStopTimetable, etag: string | null, at: Date): void;
	touchTimetable(stopId: string, generation: number, at: Date): void;
	/** 一覧にある版と停留所の発車表だけを残す。ダイヤ改正で使われなくなった版を溜めないため */
	pruneTimetables(keep: { generations: readonly number[]; stopIds: readonly string[] }): void;
}

export function createBusStore(database: Database): BusStore {
	const { db } = database;
	return {
		getCatalog() {
			const row = db.select().from(busCatalog).where(eq(busCatalog.id, CATALOG_ID)).get();
			if (!row) return null;
			return { catalog: row.body as BusCatalog, etag: row.etag, checkedAt: row.checkedAt };
		},
		saveCatalog(catalog, etag, at) {
			db.insert(busCatalog)
				.values({ id: CATALOG_ID, body: catalog, etag, checkedAt: at })
				.onConflictDoUpdate({
					target: busCatalog.id,
					set: { body: catalog, etag, checkedAt: at },
				})
				.run();
		},
		touchCatalog(at) {
			db.update(busCatalog).set({ checkedAt: at }).where(eq(busCatalog.id, CATALOG_ID)).run();
		},
		getTimetable(stopId, generation) {
			const row = db
				.select()
				.from(busStopTimetables)
				.where(
					and(eq(busStopTimetables.stopId, stopId), eq(busStopTimetables.generation, generation)),
				)
				.get();
			if (!row) return null;
			return { timetable: row.body as BusStopTimetable, etag: row.etag, checkedAt: row.checkedAt };
		},
		saveTimetable(timetable, etag, at) {
			const key = { stopId: timetable.stop.id, generation: timetable.generation.code };
			db.insert(busStopTimetables)
				.values({ ...key, body: timetable, etag, checkedAt: at })
				.onConflictDoUpdate({
					target: [busStopTimetables.stopId, busStopTimetables.generation],
					set: { body: timetable, etag, checkedAt: at },
				})
				.run();
		},
		touchTimetable(stopId, generation, at) {
			db.update(busStopTimetables)
				.set({ checkedAt: at })
				.where(
					and(eq(busStopTimetables.stopId, stopId), eq(busStopTimetables.generation, generation)),
				)
				.run();
		},
		pruneTimetables({ generations, stopIds }) {
			// 空の配列を notInArray に渡すと全件が対象になる。意図どおり「何も残さない」ことになる
			db.delete(busStopTimetables)
				.where(notInArray(busStopTimetables.generation, [...generations]))
				.run();
			db.delete(busStopTimetables)
				.where(notInArray(busStopTimetables.stopId, [...stopIds]))
				.run();
		},
	};
}
