import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createAcademicCalendarStore,
	createClassChangeStore,
	createCourseStore,
	createHolidayStore,
	createPersonalSlotStore,
	createSubjectStore,
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

function services(
	options: {
		enabled?: boolean;
		linked?: { userId: string } | null;
		status?: 'active' | 'suspended';
	} = {},
): Services {
	const { enabled = true, linked = null, status = 'active' } = options;
	return {
		origin: 'https://funmary.example.com',
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
			}),
		},
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

	it('授業がない日の /today は、その旨を返す', () => {
		const text = answerCommand(services({ linked: { userId: 'u1' } }), 'today', 'discord-1', NOW);
		expect(text).toBe('今日は、授業も休みの知らせもありません。');
	});

	it('これから 14 日に休講などがなければ、/changes はその旨を返す', () => {
		const text = answerCommand(services({ linked: { userId: 'u1' } }), 'changes', 'discord-1', NOW);
		expect(text).toBe('これから 14 日の休講、補講、教室変更はありません。');
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
