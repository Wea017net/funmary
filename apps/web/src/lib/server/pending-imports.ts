// 管理画面で上げた PDF の読み取り結果を、管理者が確かめて取り込むまでの間だけ、メモリに置く。
// PDF もその中身も保存しない。1 つのプロセスで動かす構成なので、メモリで足りる。
import { randomBytes } from 'node:crypto';

interface Entry<T> {
	readonly ownerId: string;
	readonly value: T;
	readonly expiresAt: number;
}

export interface PendingImports<T> {
	/** 置いて、取り出すための ID を返す。同じ人が前に置いたものは消す */
	put(ownerId: string, value: T, now: Date): string;
	/** 置いた人だけが、期限の前に 1 回だけ取り出せる。取り出すと消える */
	take(id: string, ownerId: string, now: Date): T | null;
	/** いま置いてある数 */
	size(): number;
}

export function createPendingImports<T>(options: { ttlMs: number }): PendingImports<T> {
	const entries = new Map<string, Entry<T>>();
	return {
		put(ownerId, value, now) {
			for (const [id, entry] of entries) {
				if (entry.ownerId === ownerId || entry.expiresAt <= now.getTime()) entries.delete(id);
			}
			const id = randomBytes(16).toString('base64url');
			entries.set(id, { ownerId, value, expiresAt: now.getTime() + options.ttlMs });
			return id;
		},
		take(id, ownerId, now) {
			const entry = entries.get(id);
			if (!entry || entry.ownerId !== ownerId) return null;
			entries.delete(id);
			return entry.expiresAt > now.getTime() ? entry.value : null;
		},
		size: () => entries.size,
	};
}
