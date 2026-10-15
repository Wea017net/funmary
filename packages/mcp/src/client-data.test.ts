import { FunmaryApiError, type FunmaryClient } from '@funmary/client';
import { describe, expect, it, vi } from 'vitest';
import { createClientData } from './client-data.ts';
import { FunmaryToolFailure } from './data.ts';

/** 使う口だけを、偽物にする。使わない口を呼んだら、テストが落ちる */
function fakeClient(overrides: Record<string, unknown> = {}) {
	return {
		subjects: {
			search: vi.fn(() => Promise.resolve({ subjects: [] })),
			get: vi.fn(),
			sessions: vi.fn(),
		},
		courses: {
			register: vi.fn(() => Promise.resolve({ registered: true })),
			unregister: vi.fn(() => Promise.resolve({ registered: false })),
			setPersonalSlot: vi.fn(() => Promise.resolve({})),
			removePersonalSlot: vi.fn(() => Promise.resolve({})),
			setAbbreviation: vi.fn(() => Promise.resolve({})),
		},
		events: { get: vi.fn(), delete: vi.fn(() => Promise.resolve(undefined)) },
		bus: {
			stops: vi.fn(),
			stop: vi.fn(),
			legs: vi.fn(() => Promise.resolve({ departures: [] })),
			next: vi.fn(),
		},
		timetable: vi.fn(() => Promise.resolve({ lessons: [] })),
		week: vi.fn(() => Promise.resolve({})),
		...overrides,
	} as unknown as FunmaryClient & Record<string, never>;
}

const notFound = () =>
	new FunmaryApiError({ status: 404, code: 'not_found', message: '見つかりません' });

const subject = (syllabusId: string, name: string) => ({ academicYear: 2026, syllabusId, name });

describe('createClientData', () => {
	it('404 は、見つからない (null) にする。ほかの誤りは、そのまま投げる', async () => {
		const client = fakeClient({
			events: { get: vi.fn(() => Promise.reject(notFound())) },
			bus: {
				stops: vi.fn(() =>
					Promise.reject(new FunmaryApiError({ status: 500, code: 'x', message: 'down' })),
				),
			},
		});
		const data = createClientData(client);
		await expect(data.event(1)).resolves.toBeNull();
		await expect(data.busStops()).rejects.toMatchObject({ status: 500 });
	});

	it('日付や年を省いた引数は、クエリに入れない', async () => {
		const client = fakeClient();
		const data = createClientData(client);
		await data.week({});
		expect(client.week).toHaveBeenLastCalledWith({});
		await data.week({ date: '2026-10-07' });
		expect(client.week).toHaveBeenLastCalledWith({ date: '2026-10-07' });
	});

	it('バスの発車は、向きと停留所を渡し、指定のない項目は渡さない', async () => {
		const client = fakeClient();
		await createClientData(client).busLeg({ stopId: '14013', direction: 'toUniversity' });
		expect(client.bus.legs).toHaveBeenCalledWith({ stopId: '14013', direction: 'toUniversity' });
	});

	it('履修登録は、年度とシラバスの番号か、名前を、そのまま API に渡す', async () => {
		const client = fakeClient();
		const data = createClientData(client);
		await data.registerCourse({ academicYear: 2026, syllabusId: '100' });
		expect(client.courses.register).toHaveBeenLastCalledWith({
			academicYear: 2026,
			syllabusId: '100',
		});
		await data.registerCourse({ name: '線形' });
		expect(client.courses.register).toHaveBeenLastCalledWith({ name: '線形' });
	});

	it('解除など、番号で指す API には、名前を、科目の検索で番号に直して渡す', async () => {
		const client = fakeClient({
			subjects: {
				search: vi.fn(() => Promise.resolve({ subjects: [subject('100', '線形代数')] })),
			},
		});
		await createClientData(client).unregisterCourse({ name: '線形' });
		expect(client.courses.unregister).toHaveBeenCalledWith({ year: 2026, syllabusId: '100' });
	});

	it('名前の完全一致が 1 つなら、部分一致が別にあっても、それを選ぶ', async () => {
		const client = fakeClient({
			subjects: {
				search: vi.fn(() =>
					Promise.resolve({
						subjects: [subject('100', '線形代数'), subject('101', '線形代数演習')],
					}),
				),
			},
		});
		await createClientData(client).setAbbreviation({ name: '線形代数' }, '線代');
		expect(client.courses.setAbbreviation).toHaveBeenCalledWith(
			{ year: 2026, syllabusId: '100' },
			'線代',
		);
	});

	it('名前が複数に当たったら、書き込まず、候補つきの文で断る。ない名前は、見つからないと断る', async () => {
		const many = fakeClient({
			subjects: {
				search: vi.fn(() =>
					Promise.resolve({ subjects: [subject('201', '情報'), subject('200', '情報')] }),
				),
			},
		});
		const failure = await createClientData(many)
			.unregisterCourse({ name: '情報' })
			.catch((caught: unknown) => caught);
		expect(failure).toBeInstanceOf(FunmaryToolFailure);
		expect((failure as Error).message).toContain('2026 200 情報 / 2026 201 情報');
		expect(many.courses.unregister).not.toHaveBeenCalled();

		await expect(createClientData(fakeClient()).unregisterCourse({ name: 'ない' })).rejects.toThrow(
			'科目が見つかりません',
		);
	});

	it('予定の削除は、本文なしで終わる', async () => {
		await expect(createClientData(fakeClient()).deleteEvent(1)).resolves.toBeUndefined();
	});
});
