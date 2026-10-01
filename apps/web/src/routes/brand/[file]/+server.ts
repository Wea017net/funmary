// ロゴ、アイコン、OGP の画像。BRAND_DIR に同じ名前の画像があれば、それを返す (lib/server/brand-assets.ts)
import { error, type RequestHandler } from '@sveltejs/kit';
import appleTouchIcon from '$lib/assets/brand/apple-touch-icon.png?inline';
import icon192 from '$lib/assets/brand/icon-192.png?inline';
import icon512 from '$lib/assets/brand/icon-512.png?inline';
import iconMaskable512 from '$lib/assets/brand/icon-maskable-512.png?inline';
import iconSvg from '$lib/assets/brand/icon.svg?inline';
import logoDark from '$lib/assets/brand/logo-dark.svg?inline';
import logoLight from '$lib/assets/brand/logo-light.svg?inline';
import ogImage from '$lib/assets/brand/og-image.png?inline';
import { decodeDataUrl, loadBrandAsset, type BrandFile } from '$lib/server/brand-assets.ts';
import { getServices } from '$lib/server/services.ts';

// 同梱の画像は、サーバーのコードに埋め込む (リリースの tar.gz の中の置き場所に依らず読めるように)
const DEFAULTS: Record<BrandFile, Uint8Array<ArrayBuffer>> = {
	'icon.svg': decodeDataUrl(iconSvg),
	'icon-192.png': decodeDataUrl(icon192),
	'icon-512.png': decodeDataUrl(icon512),
	'icon-maskable-512.png': decodeDataUrl(iconMaskable512),
	'apple-touch-icon.png': decodeDataUrl(appleTouchIcon),
	'og-image.png': decodeDataUrl(ogImage),
	'logo-light.svg': decodeDataUrl(logoLight),
	'logo-dark.svg': decodeDataUrl(logoDark),
};

export const GET: RequestHandler = async ({ params }) => {
	const asset = await loadBrandAsset(params['file'] ?? '', {
		brandDir: getServices().brandDir,
		defaults: DEFAULTS,
	});
	if (!asset) error(404, 'Not Found');
	return new Response(asset.body, {
		headers: { 'content-type': asset.type, 'cache-control': 'public, max-age=86400' },
	});
};
