// 共有の曜日と時限 (シラバスにない、または載っていない枠) を、だれが登録できるかの設定。
// 個人用の書き換え (personal_timetable_slots) は、この設定に関わらずだれでも使える
import type { SettingsStore } from '@funmary/db';

export const SLOT_SHARING_MODE_KEY = 'slot-sharing-mode';

/**
 * open: ログインしていれば誰でも共有の枠を登録できる (既定)。
 * moderated: 提出はでき、モデレーターか管理者が確認してから共有の枠に入る。
 * closed: 共有の枠は登録できない (個人用だけ使える)
 */
export type SlotSharingMode = 'open' | 'moderated' | 'closed';

export const SLOT_SHARING_MODES: readonly SlotSharingMode[] = ['open', 'moderated', 'closed'];

export const SLOT_SHARING_MODE_LABELS: Record<SlotSharingMode, string> = {
	open: 'だれでも登録できる',
	moderated: 'モデレーターか管理者が確認してから登録する',
	closed: 'だれも登録できない',
};

function isSlotSharingMode(value: unknown): value is SlotSharingMode {
	return typeof value === 'string' && (SLOT_SHARING_MODES as readonly string[]).includes(value);
}

export function readSlotSharingMode(settings: SettingsStore): SlotSharingMode {
	const value = settings.get(SLOT_SHARING_MODE_KEY);
	return isSlotSharingMode(value) ? value : 'open';
}

export function saveSlotSharingMode(
	settings: SettingsStore,
	mode: SlotSharingMode,
	now: Date,
): void {
	if (!isSlotSharingMode(mode)) throw new Error('知らない設定値です');
	settings.set(SLOT_SHARING_MODE_KEY, mode, now);
}
