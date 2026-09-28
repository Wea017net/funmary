import { describe, expect, it } from 'vitest';
import { readPdfUpload } from './pdf-upload.ts';

const PDF = new TextEncoder().encode('%PDF-1.7\n...');

function form(file: File | string | null) {
	const data = new FormData();
	if (file !== null) data.set('pdf', file);
	return data;
}

describe('readPdfUpload', () => {
	it('PDF のファイルなら、中身のバイト列を返す', async () => {
		const result = await readPdfUpload(form(new File([PDF], 'a.pdf')), 'pdf');
		expect(result).toEqual({ ok: true, value: PDF });
	});

	it('ファイルがない、空、PDF でない、大きすぎるときは断る', async () => {
		expect(await readPdfUpload(form(null), 'pdf')).toEqual({
			ok: false,
			error: 'PDF のファイルを選んでください。',
		});
		expect(await readPdfUpload(form('text'), 'pdf')).toMatchObject({ ok: false });
		expect(await readPdfUpload(form(new File([], 'a.pdf')), 'pdf')).toMatchObject({ ok: false });
		expect(await readPdfUpload(form(new File(['<html>'], 'a.pdf')), 'pdf')).toEqual({
			ok: false,
			error: 'PDF のファイルではありません。',
		});
		const large = new Uint8Array(512 * 1024 + 1);
		large.set(PDF);
		expect(await readPdfUpload(form(new File([large], 'a.pdf')), 'pdf')).toMatchObject({
			ok: false,
		});
	});
});
