import type { SubjectClassChange } from '@funmary/db';

const KIND_LABELS = { cancellation: '休講', makeup: '補講', roomChange: '教室変更' } as const;

const MAKEUP_PLAN_LABELS = {
	planned: '補講あり',
	none: '補講なし',
	undecided: '補講未定',
} as const;

/** 休講などの、画面に出すラベル (色だけで伝えないため、必ず文字で出す) と、添える説明 */
export function describeClassChange(change: SubjectClassChange): {
	label: string;
	detail: string | null;
} {
	const label = KIND_LABELS[change.kind];
	switch (change.kind) {
		case 'cancellation':
			return { label, detail: change.makeupPlan ? MAKEUP_PLAN_LABELS[change.makeupPlan] : null };
		case 'makeup':
			return { label, detail: change.room };
		case 'roomChange':
			if (change.room === null) return { label, detail: null };
			return {
				label,
				detail: change.fromRoom ? `${change.fromRoom} から ${change.room} へ` : `${change.room} へ`,
			};
	}
}
