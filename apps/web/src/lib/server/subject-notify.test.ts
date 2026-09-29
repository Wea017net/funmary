import { describe, expect, it, vi } from 'vitest';
import {
	alertSubjectDeleted,
	alertSubjectPublished,
	alertSubjectVisibilityChanged,
} from './subject-notify.ts';

const path = { year: '2026', code: 'user-abc123' };

describe('alertSubjectPublished', () => {
	it('subjects チャンネルに、科目の名前とリンクを送る', async () => {
		const alertAdmin = vi.fn();
		await alertSubjectPublished(
			{ alertAdmin, origin: 'https://funmary.example.com' },
			'キャリアガイダンス',
			path,
		);
		expect(alertAdmin).toHaveBeenCalledWith(
			expect.objectContaining({
				category: 'subjects',
				title: '科目が全体に公開されました',
				message: 'キャリアガイダンス\nhttps://funmary.example.com/app/subjects/2026/user-abc123',
			}),
		);
	});
});

describe('alertSubjectVisibilityChanged', () => {
	it('変えた先の公開範囲をタイトルに載せる', async () => {
		const alertAdmin = vi.fn();
		await alertSubjectVisibilityChanged(
			{ alertAdmin, origin: 'https://funmary.example.com' },
			'キャリアガイダンス',
			path,
			'private',
		);
		expect(alertAdmin).toHaveBeenCalledWith(
			expect.objectContaining({
				title: expect.stringContaining('非公開') as string,
			}),
		);
	});
});

describe('alertSubjectDeleted', () => {
	it('科目の名前を送る', async () => {
		const alertAdmin = vi.fn();
		await alertSubjectDeleted({ alertAdmin }, 'キャリアガイダンス');
		expect(alertAdmin).toHaveBeenCalledWith(
			expect.objectContaining({ category: 'subjects', message: 'キャリアガイダンス' }),
		);
	});
});
