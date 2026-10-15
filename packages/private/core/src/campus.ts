// 学内にいるかの判定。バスの画面が、向き (未来大から出るか、未来大へ向かうか) をはじめに決めるのに使う。
// - 学内の Wi-Fi: 接続元の IP アドレスが、設定した範囲に入るか
// - 現在地: 端末の位置情報が、未来大の近くか
// I/O は持たない。

/** 未来大の位置 (緯度と経度)。大まかな値で、近くにいるかの判定にだけ使う */
export const UNIVERSITY_LOCATION = { latitude: 41.8419, longitude: 140.7668 } as const;

/** 「未来大の近く」とみなす距離 (メートル) */
export const NEAR_UNIVERSITY_METERS = 600;

const EARTH_RADIUS_METERS = 6_371_000;

/** 2 点の距離 (メートル)。球面の近似 (haversine) */
function distanceMeters(
	a: { latitude: number; longitude: number },
	b: { latitude: number; longitude: number },
): number {
	const rad = (degrees: number) => (degrees * Math.PI) / 180;
	const dLat = rad(b.latitude - a.latitude);
	const dLon = rad(b.longitude - a.longitude);
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
	return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

export function isNearUniversity(
	latitude: number,
	longitude: number,
	meters: number = NEAR_UNIVERSITY_METERS,
): boolean {
	if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
	return distanceMeters({ latitude, longitude }, UNIVERSITY_LOCATION) <= meters;
}

/** "a.b.c.d" を 32 ビットの整数にする。IPv4 でなければ null (::ffff:a.b.c.d の形は IPv4 として読む) */
function ipv4ToInt(address: string): number | null {
	const plain = address.replace(/^::ffff:/i, '');
	const parts = plain.split('.');
	if (parts.length !== 4) return null;
	let value = 0;
	for (const part of parts) {
		if (!/^\d{1,3}$/.test(part)) return null;
		const octet = Number(part);
		if (octet > 255) return null;
		value = value * 256 + octet;
	}
	return value;
}

/** アドレスが、範囲 (a.b.c.d/n の CIDR、または単独のアドレス) のどれかに入るか。IPv4 だけを扱い、読めないものは外れとする */
export function isInIpRanges(address: string, ranges: readonly string[]): boolean {
	const value = ipv4ToInt(address);
	if (value === null) return false;
	return ranges.some((range) => {
		const [base, bitsText] = range.split('/');
		const start = ipv4ToInt(base ?? '');
		if (start === null) return false;
		const bits = bitsText === undefined ? 32 : Number(bitsText);
		if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
		if (bits === 0) return true;
		const size = 2 ** (32 - bits);
		return Math.floor(value / size) === Math.floor(start / size);
	});
}
