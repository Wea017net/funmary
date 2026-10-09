// 実際の DOM は使わず、addEventListener/removeEventListener だけを持つ偽の要素で試す
// (このパッケージのテストは Node 環境で動かし、jsdom は入れていないため)
import { describe, expect, it, vi } from 'vitest';
import { confirmSubmit } from './confirm-submit.ts';

type Listener = (event: {
	preventDefault: () => void;
	stopImmediatePropagation: () => void;
}) => void;
type Options = { capture?: boolean } | undefined;

// イベントの対象の要素での、ブラウザの動きをまねる。捕捉 (capture) のリスナーを登録の順に関係なく先に呼び、
// stopImmediatePropagation のあとのリスナーは呼ばない。外すときは、登録と同じ capture を指定しないと外れない
function createFakeForm() {
	const listeners: { listener: Listener; capture: boolean }[] = [];
	return {
		addEventListener: (_type: string, listener: Listener, options?: Options) =>
			listeners.push({ listener, capture: options?.capture ?? false }),
		removeEventListener: (_type: string, listener: Listener, options?: Options) => {
			const capture = options?.capture ?? false;
			const index = listeners.findIndex(
				(entry) => entry.listener === listener && entry.capture === capture,
			);
			if (index >= 0) listeners.splice(index, 1);
		},
		fireSubmit: () => {
			let stopped = false;
			const event = {
				preventDefault: vi.fn(),
				stopImmediatePropagation: vi.fn(() => {
					stopped = true;
				}),
			};
			const ordered = [
				...listeners.filter((entry) => entry.capture),
				...listeners.filter((entry) => !entry.capture),
			];
			for (const { listener } of ordered) {
				if (stopped) break;
				listener(event);
			}
			return event;
		},
	};
}

describe('confirmSubmit', () => {
	it('確認すると、送信を止めない', () => {
		vi.stubGlobal(
			'confirm',
			vi.fn(() => true),
		);
		const form = createFakeForm();
		confirmSubmit(form as unknown as HTMLFormElement, '消しますか?');

		const event = form.fireSubmit();

		expect(confirm).toHaveBeenCalledWith('消しますか?');
		expect(event.preventDefault).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it('断ると、送信を止める', () => {
		vi.stubGlobal(
			'confirm',
			vi.fn(() => false),
		);
		const form = createFakeForm();
		confirmSubmit(form as unknown as HTMLFormElement, '消しますか?');

		const event = form.fireSubmit();

		expect(event.preventDefault).toHaveBeenCalled();
		expect(event.stopImmediatePropagation).toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it('断ると、先に登録された use:enhance のリスナーも呼ばない', () => {
		vi.stubGlobal(
			'confirm',
			vi.fn(() => false),
		);
		const form = createFakeForm();
		const enhanceListener = vi.fn();
		form.addEventListener('submit', enhanceListener);
		confirmSubmit(form as unknown as HTMLFormElement, '消しますか?');

		form.fireSubmit();

		expect(enhanceListener).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it('update で、確認の文言を変えられる', () => {
		vi.stubGlobal(
			'confirm',
			vi.fn(() => true),
		);
		const form = createFakeForm();
		const action = confirmSubmit(form as unknown as HTMLFormElement, '最初の文言');

		action?.update?.('直した文言');
		form.fireSubmit();

		expect(confirm).toHaveBeenCalledWith('直した文言');
		vi.unstubAllGlobals();
	});

	it('destroy で、リスナーを外す', () => {
		vi.stubGlobal(
			'confirm',
			vi.fn(() => false),
		);
		const form = createFakeForm();
		const action = confirmSubmit(form as unknown as HTMLFormElement, '消しますか?');

		action?.destroy?.();
		const event = form.fireSubmit();

		expect(confirm).not.toHaveBeenCalled();
		expect(event.preventDefault).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});
});
