import { INITIAL_SOURCE_HEALTH, type BusCatalog, type BusStopTimetable } from '@funmary/core';
import { createLogger } from '@funmary/log';
import { describe, expect, it, vi } from 'vitest';
import type { JobContext } from './runner.ts';
import { BUS_SOURCE, createSyncBusJob, type SyncBusDeps } from './sync-bus.ts';

const NOW = new Date('2026-10-10T20:00:00Z');

const catalog: BusCatalog = {
	generatedAt: '2026-10-10T19:00:00.000Z',
	generations: [
		{ code: 20261001, name: '令和8年10月1日', current: true },
		{ code: 20261020, name: '令和8年10月20日', current: false },
	],
	stops: [
		{ id: '14013', name: '亀田支所前' },
		{ id: '14023', name: 'はこだて未来大学' },
	],
};

function timetableOf(stopId: string, generationCode: number): BusStopTimetable {
	const generation = catalog.generations.find((g) => g.code === generationCode)!;
	return {
		generatedAt: '2026-10-10T19:00:00.000Z',
		generation,
		stop: catalog.stops.find((s) => s.id === stopId)!,
		timetables: [],
	};
}

type CatalogResult = Awaited<ReturnType<SyncBusDeps['fetchCatalog']>>;
type TimetableResult = Awaited<ReturnType<SyncBusDeps['fetchTimetable']>>;

function setup(
	options: {
		catalogResult?: CatalogResult;
		timetableResult?: (stopId: string, generation: number) => TimetableResult;
		storedCatalog?: { catalog: BusCatalog; etag: string | null; checkedAt: Date } | null;
		storedTimetableEtag?: string | null;
		disabled?: string[];
	} = {},
) {
	let health = INITIAL_SOURCE_HEALTH;
	const saved = { catalogs: 0, timetables: [] as string[], touchedTimetables: [] as string[] };
	const pruned: unknown[] = [];
	const alerts: { title: string }[] = [];
	const touchCatalog = vi.fn<SyncBusDeps['bus']['touchCatalog']>();
	const fetchCatalog = vi.fn<SyncBusDeps['fetchCatalog']>(() =>
		Promise.resolve(options.catalogResult ?? { kind: 'updated', list: catalog, etag: '"c"' }),
	);
	const fetchTimetable = vi.fn<SyncBusDeps['fetchTimetable']>(({ stopId, generation }) =>
		Promise.resolve(
			options.timetableResult?.(stopId, generation) ?? {
				kind: 'updated',
				timetable: timetableOf(stopId, generation),
				etag: '"t"',
			},
		),
	);
	const deps: SyncBusDeps = {
		fetchCatalog,
		fetchTimetable,
		disabledSources: options.disabled ?? [],
		health: {
			load: () => health,
			save: (_source, next) => {
				health = next;
			},
		},
		bus: {
			getCatalog: () => options.storedCatalog ?? null,
			saveCatalog: () => {
				saved.catalogs += 1;
			},
			touchCatalog,
			getTimetable: () =>
				options.storedTimetableEtag === undefined
					? null
					: {
							timetable: timetableOf('14013', 20261001),
							etag: options.storedTimetableEtag,
							checkedAt: NOW,
						},
			saveTimetable: (timetable) => {
				saved.timetables.push(`${timetable.stop.id}:${timetable.generation.code}`);
			},
			touchTimetable: (stopId, generation) => {
				saved.touchedTimetables.push(`${stopId}:${generation}`);
			},
			pruneTimetables: (keep) => {
				pruned.push(keep);
			},
		},
		alert: (alert) => {
			alerts.push(alert);
			return Promise.resolve();
		},
	};
	const context: JobContext = {
		signal: new AbortController().signal,
		now: () => NOW,
		log: createLogger({ level: 'error', format: 'text', mode: 'development' }),
	};
	return {
		job: createSyncBusJob(deps),
		deps,
		context,
		fetchCatalog,
		fetchTimetable,
		saved,
		touchCatalog,
		pruned,
		alerts,
		health: () => health,
	};
}

describe('バスの時刻表の定期処理', () => {
	it('毎日、日本時間の 5 時台に動く', () => {
		const { job } = setup();
		expect(job.name).toBe('sync-bus');
		expect(job.schedule).toBe('30 5 * * *');
	});

	it('一覧と、すべての停留所と版の発車表を保存し、成功を記録する', async () => {
		const t = setup();
		const message = await t.job.run(t.context);
		expect(t.saved.catalogs).toBe(1);
		expect(t.saved.timetables.sort()).toEqual([
			'14013:20261001',
			'14013:20261020',
			'14023:20261001',
			'14023:20261020',
		]);
		expect(t.health().lastSuccessAt).toEqual(NOW);
		expect(message).toContain('4');
	});

	it('保存した ETag を送り、304 なら確かめた日時だけ更新する', async () => {
		const t = setup({
			storedTimetableEtag: '"old"',
			timetableResult: () => ({ kind: 'not-modified' }),
		});
		await t.job.run(t.context);
		expect(t.saved.timetables).toEqual([]);
		expect(t.saved.touchedTimetables).toHaveLength(4);
		const first = t.fetchTimetable.mock.calls.find(
			([arg]) => arg.stopId === '14013' && arg.generation === 20261001,
		);
		expect(first?.[0].etag).toBe('"old"');
	});

	it('一覧が 304 なら、保存してある一覧で発車表を取りに行く', async () => {
		const t = setup({
			catalogResult: { kind: 'not-modified' },
			storedCatalog: { catalog, etag: '"c"', checkedAt: NOW },
		});
		await t.job.run(t.context);
		expect(t.saved.catalogs).toBe(0);
		expect(t.touchCatalog).toHaveBeenCalledWith(NOW);
		expect(t.fetchTimetable).toHaveBeenCalledTimes(4);
	});

	it('一覧が 304 でも保存した一覧がなければ、失敗として扱う', async () => {
		const t = setup({ catalogResult: { kind: 'not-modified' }, storedCatalog: null });
		await expect(t.job.run(t.context)).rejects.toThrow();
	});

	it('一覧の取得に失敗したら、失敗を記録して例外にする', async () => {
		const t = setup({ catalogResult: { kind: 'failed', message: 'down' } });
		await expect(t.job.run(t.context)).rejects.toThrow('down');
		expect(t.health().consecutiveFailures).toBe(1);
	});

	it('サーバーにまだ時刻表がないときも、失敗として記録する', async () => {
		const t = setup({ catalogResult: { kind: 'not-ready' } });
		await expect(t.job.run(t.context)).rejects.toThrow();
	});

	it('一部の発車表を取れなくても、取れた分は保存し、最後に失敗として知らせる', async () => {
		const t = setup({
			timetableResult: (stopId, generation) =>
				stopId === '14023'
					? { kind: 'failed', message: 'bad' }
					: { kind: 'updated', timetable: timetableOf(stopId, generation), etag: null },
		});
		await expect(t.job.run(t.context)).rejects.toThrow('2 件');
		expect(t.saved.timetables).toHaveLength(2);
	});

	it('サーバーにない発車表 (404) は、失敗にせず数えるだけにする', async () => {
		const t = setup({
			timetableResult: (stopId, generation) =>
				generation === 20261020
					? { kind: 'not-found' }
					: { kind: 'updated', timetable: timetableOf(stopId, generation), etag: null },
		});
		const message = await t.job.run(t.context);
		expect(message).toContain('ありません');
		expect(t.health().consecutiveFailures).toBe(0);
	});

	it('一覧にある版と停留所以外の発車表を捨てる', async () => {
		const t = setup();
		await t.job.run(t.context);
		expect(t.pruned).toEqual([{ generations: [20261001, 20261020], stopIds: ['14013', '14023'] }]);
	});

	it('SOURCES_DISABLED に bus があれば、何もしない', async () => {
		const t = setup({ disabled: [BUS_SOURCE] });
		await t.job.run(t.context);
		expect(t.fetchCatalog).not.toHaveBeenCalled();
	});

	it('不調のあとの待ち時間の間は、取得しない', async () => {
		const t = setup({ catalogResult: { kind: 'failed', message: 'down' } });
		await expect(t.job.run(t.context)).rejects.toThrow();
		await expect(t.job.run(t.context)).resolves.toContain('待');
	});

	it('中断の合図が出たら、残りの取得をやめる', async () => {
		const controller = new AbortController();
		const t = setup({
			timetableResult: (stopId, generation) => {
				controller.abort();
				return { kind: 'updated', timetable: timetableOf(stopId, generation), etag: null };
			},
		});
		await expect(t.job.run({ ...t.context, signal: controller.signal })).rejects.toThrow();
		expect(t.fetchTimetable).toHaveBeenCalledTimes(1);
	});
});
