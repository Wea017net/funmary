import { describe, expect, it } from 'vitest';
import { createPendingImports } from './pending-imports.ts';

const T0 = new Date('2026-10-01T00:00:00Z');
const later = (minutes: number) => new Date(T0.getTime() + minutes * 60 * 1000);

describe('createPendingImports', () => {
	it('置いた人だけが、1 回だけ取り出せる', () => {
		const pending = createPendingImports<string>({ ttlMs: 15 * 60 * 1000 });
		const id = pending.put('admin-a', '学年暦', T0);
		expect(id).toMatch(/^[\w-]{22,}$/);
		expect(pending.take(id, 'admin-b', later(1))).toBeNull();
		expect(pending.take(id, 'admin-a', later(1))).toBe('学年暦');
		expect(pending.take(id, 'admin-a', later(2))).toBeNull();
	});

	it('期限を過ぎたものは取り出せない', () => {
		const pending = createPendingImports<string>({ ttlMs: 15 * 60 * 1000 });
		const id = pending.put('admin-a', '学年暦', T0);
		expect(pending.take(id, 'admin-a', later(16))).toBeNull();
	});

	it('同じ人が置き直すと前のものは消え、期限切れのものは置くときに片付ける', () => {
		const pending = createPendingImports<string>({ ttlMs: 15 * 60 * 1000 });
		const first = pending.put('admin-a', '前期', T0);
		const second = pending.put('admin-a', '後期', later(1));
		expect(pending.take(first, 'admin-a', later(2))).toBeNull();
		expect(pending.take(second, 'admin-a', later(2))).toBe('後期');

		pending.put('admin-b', '古い', T0);
		pending.put('admin-c', '新しい', later(30));
		expect(pending.size()).toBe(1);
	});

	it('知らない ID では何も取り出せない', () => {
		const pending = createPendingImports<string>({ ttlMs: 60_000 });
		expect(pending.take('unknown', 'admin-a', T0)).toBeNull();
	});
});
