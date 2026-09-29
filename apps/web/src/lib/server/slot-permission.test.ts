import { describe, expect, it } from 'vitest';
import {
	readSlotSharingMode,
	saveSlotSharingMode,
	SLOT_SHARING_MODE_KEY,
	type SlotSharingMode,
} from './slot-permission.ts';

function fakeSettings(initial: unknown = null) {
	let value = initial;
	return {
		get: (key: string) => (key === SLOT_SHARING_MODE_KEY ? value : null),
		set: (key: string, v: unknown) => {
			if (key === SLOT_SHARING_MODE_KEY) value = v;
		},
	};
}

describe('readSlotSharingMode', () => {
	it('保存していなければ open', () => {
		expect(readSlotSharingMode(fakeSettings())).toBe('open');
	});

	it('壊れた値なら open', () => {
		expect(readSlotSharingMode(fakeSettings('unknown'))).toBe('open');
		expect(readSlotSharingMode(fakeSettings({ mode: 'moderated' }))).toBe('open');
	});

	it('保存した値をそのまま返す', () => {
		const settings = fakeSettings();
		const now = new Date('2026-10-01T00:00:00Z');
		for (const mode of ['open', 'moderated', 'closed'] satisfies SlotSharingMode[]) {
			saveSlotSharingMode(settings, mode, now);
			expect(readSlotSharingMode(settings)).toBe(mode);
		}
	});
});
