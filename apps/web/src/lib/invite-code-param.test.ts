import { describe, expect, it } from 'vitest';
import { parseInviteCodeParam } from './invite-code-param.ts';

describe('parseInviteCodeParam', () => {
	it('招待コードをそのまま返す', () => {
		expect(parseInviteCodeParam('XCkU5IiiPfSM7XR0IxVHOg')).toBe('XCkU5IiiPfSM7XR0IxVHOg');
	});

	it('前後の空白は取り除く', () => {
		expect(parseInviteCodeParam('  abc \n')).toBe('abc');
	});

	it('ないか空なら null', () => {
		expect(parseInviteCodeParam(null)).toBeNull();
		expect(parseInviteCodeParam('   ')).toBeNull();
	});

	it('入力欄の長さの上限で切る', () => {
		expect(parseInviteCodeParam('a'.repeat(300))).toHaveLength(100);
	});
});
