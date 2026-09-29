// 実際の DOM は使わず、addEventListener/removeEventListener だけを持つ偽の要素で試す
// (このパッケージのテストは Node 環境で動かし、jsdom は入れていないため)
import { describe, expect, it, vi } from 'vitest';
import { confirmSubmit } from './confirm-submit.ts';

type Listener = (event: {
	preventDefault: () => void;
	stopImmediatePropagation: () => void;
}) => void;

function createFakeForm() {
	const listeners: Listener[] = [];
	return {
		addEventListener: (_type: string, listener: Listener) => listeners.push(listener),
		removeEventListener: (_type: string, listener: Listener) => {
			const index = listeners.indexOf(listener);
			if (index >= 0) listeners.splice(index, 1);
		},
		fireSubmit: () => {
			const event = { preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
			for (const listener of listeners) listener(event);
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
