// 履修している科目の休講、補講、教室変更を、利用者の通知欄に入れる定期処理 (設計書 14.1、14.7)。
// 候補を毎回すべて見直し、同じ出来事は通知欄の側で 1 回だけ足す。照合があとから済んだ休講も、次の回に拾える
import { jstDateTime } from '@funmary/core';
import type { JobDefinition } from './runner.ts';

export interface ClassChangeNotificationSource {
	readonly userId: string;
	readonly classChangeId: number;
	readonly kind: 'cancellation' | 'makeup' | 'roomChange';
	readonly date: string;
	readonly period: number;
	readonly room: string | null;
	readonly fromRoom: string | null;
	readonly subjectId: number;
	readonly subjectName: string;
	readonly academicYear: number;
	readonly syllabusId: string;
}

export interface ClassChangeNotificationEntry {
	readonly userId: string;
	readonly kind: 'cancellation' | 'makeup' | 'roomChange';
	readonly title: string;
	readonly body: string | null;
	readonly link: string;
	readonly subjectId: number;
	readonly dedupeKey: string;
}

const KIND_LABELS = { cancellation: '休講', makeup: '補講', roomChange: '教室変更' } as const;

/** 題は `[休講] 情報処理演習 (10/3 2 限)` の形 (設計書 14.5) */
export function classChangeNotification(
	source: ClassChangeNotificationSource,
): ClassChangeNotificationEntry {
	const [, month, day] = source.date.split('-').map(Number);
	const body =
		source.kind === 'roomChange' && source.room
			? `${source.fromRoom ?? '(不明)'} → ${source.room}`
			: source.kind === 'makeup' && source.room
				? `教室: ${source.room}`
				: null;
	return {
		userId: source.userId,
		kind: source.kind,
		title: `[${KIND_LABELS[source.kind]}] ${source.subjectName} (${month}/${day} ${source.period} 限)`,
		body,
		link: `/app/subjects/${source.academicYear}/${encodeURIComponent(source.syllabusId)}`,
		subjectId: source.subjectId,
		dedupeKey: `class-change:${source.classChangeId}`,
	};
}

export interface NotifyClassChangesDeps {
	readonly candidates: (today: string) => readonly ClassChangeNotificationSource[];
	/** 足した通知の ID を返す (二重のものは足さない) */
	readonly insert: (
		entries: readonly ClassChangeNotificationEntry[],
		now: Date,
	) => readonly number[];
}

export function createNotifyClassChangesJob(deps: NotifyClassChangesDeps): JobDefinition {
	return {
		name: 'notify-class-changes',
		// 休講などの取得 (1 日 3 回) や、管理画面での授業名の紐付けのあとに、すぐ拾えるよう 5 分ごとに見る
		schedule: '*/5 * * * *',
		timeoutMs: 60 * 1000,
		quietWhenIdle: true,
		run({ now }) {
			const at = now();
			const entries = deps.candidates(jstDateTime(at).date).map(classChangeNotification);
			const inserted = deps.insert(entries, at);
			return Promise.resolve(
				inserted.length > 0 ? `休講などの通知を ${inserted.length} 件足しました` : undefined,
			);
		},
	};
}

/** 通知欄に残す日数 (設計書 14.2) */
const RETENTION_DAYS = 90;

export function createPruneNotificationsJob(deps: {
	readonly prune: (before: Date) => number;
}): JobDefinition {
	return {
		name: 'prune-notifications',
		schedule: '30 4 * * *',
		timeoutMs: 60 * 1000,
		run({ now }) {
			const before = new Date(now().getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
			const count = deps.prune(before);
			return Promise.resolve(`${RETENTION_DAYS} 日より前の通知を ${count} 件消しました`);
		},
	};
}
