import { describe, expect, it } from 'vitest';
import { extractPdfPages, parseAcademicCalendarPdf } from './extract.ts';

/** ページごとの内容のストリームから、最小の PDF を作る。模様 (網点) の塗りを /P1 で使える */
function minimalPdf(streams: string[]): Uint8Array {
	const pattern =
		'<< /Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 4 4] /XStep 4 /YStep 4 /Resources << >> /Length 21 >>\nstream\n0 0 0 rg 0 0 1 1 re f\nendstream';
	const pageIds = streams.map((_, i) => 5 + i * 2);
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${streams.length} >>`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
		pattern,
	];
	for (const [i, stream] of streams.entries()) {
		objects.push(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents ${pageIds[i]! + 1} 0 R /Resources << /Font << /F1 3 0 R >> /Pattern << /P1 4 0 R >> >> >>`,
			`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		);
	}
	let body = '%PDF-1.4\n';
	const offsets: number[] = [];
	objects.forEach((object, i) => {
		offsets.push(body.length);
		body += `${i + 1} 0 obj\n${object}\nendobj\n`;
	});
	const xref = body.length;
	body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
	body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
	return new TextEncoder().encode(body);
}

describe('学年暦の PDF からの文字と塗りの取り出し', () => {
	// 最初に pdfjs と worker を読み込むので、ほかのテストと並んで動くと 5 秒を超えることがある
	it('ページごとに、文字の位置と、塗りの色と範囲を取り出す', { timeout: 30_000 }, async () => {
		const result = await extractPdfPages(
			minimalPdf([
				[
					'0.749 0.749 0.749 rg 100 200 50 20 re f',
					'/Pattern cs /P1 scn 200 200 50 20 re f*',
					'BT /F1 10 Tf 110 205 Td (12) Tj ET',
				].join('\n'),
				'1 0 0 rg 10 10 5 5 re f',
			]),
		);
		if (result.kind !== 'ok') throw new Error(`読めるはず: ${JSON.stringify(result)}`);
		const [first, second] = result.pages;
		expect(first?.texts).toMatchObject([{ text: '12', x: 110, y: 205 }]);
		expect(first?.fills).toHaveLength(2);
		expect(first?.fills[0]).toMatchObject({ fill: '#bfbfbf', x0: 100, y0: 200, x1: 150, y1: 220 });
		expect(first?.fills[1]).toMatchObject({ x0: 200, y0: 200, x1: 250, y1: 220 });
		expect(first?.fills[1]?.fill).toMatch(/^pattern:/);
		expect(second?.fills).toMatchObject([{ fill: '#ff0000', x0: 10, y0: 10, x1: 15, y1: 15 }]);
	});

	it('座標の変換 (cm) を反映し、線だけの図形は塗りに含めない', async () => {
		const result = await extractPdfPages(
			minimalPdf(['q 2 0 0 2 10 20 cm 0 0 1 rg 5 5 10 10 re f Q\n0 0 0 RG 300 300 50 50 re S']),
		);
		if (result.kind !== 'ok') throw new Error(`読めるはず: ${JSON.stringify(result)}`);
		expect(result.pages[0]?.fills).toEqual([{ fill: '#0000ff', x0: 20, y0: 30, x1: 40, y1: 50 }]);
	});

	it('PDF ではない入力は、例外にせず invalid にする', async () => {
		const result = await extractPdfPages(new TextEncoder().encode('これは PDF ではない'));
		expect(result.kind).toBe('invalid');
	});

	it('学年暦の表でない PDF は invalid にする', async () => {
		const result = await parseAcademicCalendarPdf(
			minimalPdf(['BT /F1 10 Tf 100 200 Td (Hello) Tj ET']),
		);
		expect(result.kind).toBe('invalid');
	});
});
