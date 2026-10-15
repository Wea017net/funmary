// 管理画面で変える設定の保存。値は JSON で、形を確かめるのは読む側 (設定ごとに形が違うため)。
import { eq } from 'drizzle-orm';
import type { Database } from './database.ts';
import { settings } from './schema.ts';

export interface SettingsStore {
	/** 保存された値。形は確かめていないので、読む側で確かめる。なければ null */
	get(key: string): unknown;
	set(key: string, value: unknown, now: Date): void;
}

export function createSettingsStore(database: Database): SettingsStore {
	const { db } = database;
	return {
		get(key) {
			return db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;
		},
		set(key, value, now) {
			db.insert(settings)
				.values({ key, value, updatedAt: now })
				.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } })
				.run();
		},
	};
}
