import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createAcademicCalendarStore,
	createAuthStore,
	createClassChangeStore,
	createCourseStore,
	createHolidayStore,
	createPersonalSlotStore,
	createSourceHealthStore,
	createSubjectStore,
	createUserEventStore,
	openDatabase,
	type Database,
} from '@funmary/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { answerCommand } from './discord-commands.ts';
import type { Services } from './services.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-discord-commands-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date('2026-10-07T01:00:00Z');
const TERMS_VERSION = '2026-10-03';

function services(
	options: {
		enabled?: boolean;
		linked?: { userId: string } | null;
		status?: 'active' | 'suspended';
		/** 利用者が同意した規約の版。省くと、いまの版に同意済み */
		accepted?: string | null;
		/** 取得に最後に成功した日時。省くと、直前に成功したことにする */
		lastSuccessAt?: Date | null;
	} = {},
): Services {
	const { enabled = true, linked = null, status = 'active' } = options;
	const sourceHealth = createSourceHealthStore(database);
	const lastSuccessAt =
		options.lastSuccessAt === undefined
			? new Date(NOW.getTime() - 60 * 1000)
			: options.lastSuccessAt;
	sourceHealth.save('portal', { ...sourceHealth.load('portal'), lastSuccessAt });
	const accepted = options.accepted === undefined ? TERMS_VERSION : options.accepted;
	return {
		origin: 'https://funmary.example.com',
		termsVersion: TERMS_VERSION,
		discord: {
			link: {
				enabled: () => enabled,
				store: { findByDiscordUserId: () => (linked ? { userId: linked.userId } : null) },
			},
		},
		auth: {
			findUserById: (id: string) => ({
				id,
				email: 'a@fun.ac.jp',
				name: null,
				role: 'user',
				status,
				termsAcceptedVersion: accepted,
			}),
		},
		sourceHealth,
		userEvents: createUserEventStore(database),
		courses: createCourseStore(database),
		personalSlots: createPersonalSlotStore(database),
		subjects: createSubjectStore(database),
		classChanges: createClassChangeStore(database),
		academicCalendar: createAcademicCalendarStore(database),
		holidays: createHolidayStore(database),
		estimateHolidays: () => [],
	} as unknown as Services;
}

describe('answerCommand', () => {
	it('連携していない人には、連携の案内を返す', () => {
		const text = answerCommand(services(), 'today', 'discord-1', NOW);
		expect(text).toContain('まだ Funmary に連携されていません');
		expect(text).toContain('https://funmary.example.com/app/settings/discord');
	});

	it('連携の受付を止めているあいだは、その旨を返す', () => {
		const text = answerCommand(services({ enabled: false }), 'today', 'discord-1', NOW);
		expect(text).toContain('いまは停止しています');
	});

	it('停止した利用者には、答えない', () => {
		const text = answerCommand(
			services({ linked: { userId: 'u1' }, status: 'suspended' }),
			'today',
			'discord-1',
			NOW,
		);
		expect(text).toContain('利用できません');
	});

	it('利用規約に同意するまでは、どのコマンドにも答えず、同意の画面を案内する', () => {
		for (const command of ['today', 'next', 'week', 'changes']) {
			const text = answerCommand(
				services({ linked: { userId: 'u1' }, accepted: null }),
				command,
				'discord-1',
				NOW,
			);
			expect(text, command).toContain('同意するまで、すべての機能を停止しています');
			expect(text, command).toContain('https://funmary.example.com/consent');
		}
	});

	it('古い版にしか同意していなければ、同じく止める', () => {
		const text = answerCommand(
			services({ linked: { userId: 'u1' }, accepted: '2026-09-01' }),
			'today',
			'discord-1',
			NOW,
		);
		expect(text).toContain('https://funmary.example.com/consent');
	});

	it('授業がない日の /today は、その旨を返す', () => {
		const text = answerCommand(services({ linked: { userId: 'u1' } }), 'today', 'discord-1', NOW);
		expect(text).toBe('今日は、授業も休みの知らせもありません。');
	});

	it('これから 14 日に休講などがなければ、/changes はその旨を返す', () => {
		const text = answerCommand(services({ linked: { userId: 'u1' } }), 'changes', 'discord-1', NOW);
		expect(text).toBe('これから 14 日の休講、補講、教室変更はありません。');
	});

	it('データが古いときは、答えの終わりに注意を添える', () => {
		const text = answerCommand(
			services({ linked: { userId: 'u1' }, lastSuccessAt: null }),
			'today',
			'discord-1',
			NOW,
		);
		expect(text).toContain('今日は、授業も休みの知らせもありません。');
		expect(text).toContain('しばらく更新されていません');
	});

	it('今日の予定を、/today に出す', () => {
		const ownerId = createAuthStore(database).createUser(
			{ googleSub: 'owner', email: 'a@fun.ac.jp', name: null, role: 'user' },
			NOW,
		);
		createUserEventStore(database).create(
			ownerId,
			{
				title: '架空のサークル',
				location: '架空の部室',
				notes: null,
				startDate: '2026-10-07',
				endDate: '2026-10-07',
				time: { kind: 'time', start: '18:00', end: '19:30' },
				rrule: null,
				excludedDates: [],
				visibility: 'private',
			},
			NOW,
		);

		const text = answerCommand(
			services({ linked: { userId: ownerId } }),
			'today',
			'discord-1',
			NOW,
		);

		expect(text).toContain('18:00-19:30 架空のサークル (架空の部室) [予定]');
	});

	it('授業がなければ、/next はその旨を返す', () => {
		const text = answerCommand(services({ linked: { userId: 'u1' } }), 'next', 'discord-1', NOW);
		expect(text).toBe('これから 14 日の間に、授業の予定はありません。');
	});

	it('知らないコマンドには、対応していないと返す', () => {
		const text = answerCommand(services({ linked: { userId: 'u1' } }), 'unknown', 'discord-1', NOW);
		expect(text).toBe('そのコマンドには対応していません。');
	});
});
