import { parseAbbreviation as parseAbbreviationInput } from '@funmary/core';
import defaults from './subject-abbreviations.json';

const defaultAbbreviations: ReadonlyMap<string, string> = new Map(Object.entries(defaults));

/** 未保存だけデフォルトを使う。個人が空欄を保存したら正式名称に戻す */
export const resolveSubjectAbbreviation = (
	name: string,
	personal: string | undefined,
	abbreviations: ReadonlyMap<string, string> = defaultAbbreviations,
): string => (personal ?? abbreviations.get(name) ?? '').trim();

export const parseAbbreviation = (
	input: FormDataEntryValue | null,
): { ok: true; value: string } | { ok: false; error: string } => parseAbbreviationInput(input);
