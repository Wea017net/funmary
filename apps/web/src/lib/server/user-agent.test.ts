import { describe, expect, it } from 'vitest';
import { describeUserAgent } from './user-agent.ts';

const UA = {
	chromeWindows:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
	edgeWindows:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
	safariIphone:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
	firefoxMac:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0',
	chromeAndroid:
		'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
};

describe('describeUserAgent', () => {
	it('ブラウザの名前と主な版、OS を出す', () => {
		expect(describeUserAgent(UA.chromeWindows)).toEqual({ browser: 'Chrome 140', os: 'Windows' });
		expect(describeUserAgent(UA.edgeWindows).browser).toBe('Microsoft Edge 140');
		expect(describeUserAgent(UA.safariIphone)).toEqual({ browser: 'Safari 18', os: 'iOS 18.6' });
		expect(describeUserAgent(UA.chromeAndroid).os).toBe('Android 15');
	});

	it('Windows と macOS は、UA の版が実際の版と合わないので、版を付けない', () => {
		expect(describeUserAgent(UA.firefoxMac)).toEqual({ browser: 'Firefox 143', os: 'macOS' });
	});

	it('読めなければ、不明と出す', () => {
		expect(describeUserAgent('curl/8.0')).toEqual({ browser: '不明なブラウザ', os: '不明な OS' });
		expect(describeUserAgent(null)).toEqual({ browser: '不明なブラウザ', os: '不明な OS' });
	});
});
