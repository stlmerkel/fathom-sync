// Pure helpers — no Obsidian import, so Vitest can load this file.

function unquote(s: string): string {
	return s.trim().replace(/^['"]/, '').replace(/['"]$/, '').trim();
}

// Control chars, NBSP, zero-width and BOM survive trim() (lessons L31). Spelled out
// rather than \p{C}\p{Z} because tsconfig targets ES6. Always as \u escapes: a literal
// U+2028/U+2029 is a line terminator and would end the regex literal mid-class.
const INVISIBLE = /[\u0000-\u001F\u007F-\u00A0\u200B-\u200F\u2028\u2029\u202F\u2060\uFEFF\s]/g;

/** Lowercased, stripped email, or '' when the value isn't a usable address. */
export function normalizeEmail(value: unknown): string {
	if (typeof value !== 'string') return '';
	const v = unquote(value).replace(INVISIBLE, '').toLowerCase();
	return /^[^@]+@[^@]+$/.test(v) ? v : '';
}

export function domainOf(email: string): string {
	const at = email.lastIndexOf('@');
	return at === -1 ? '' : email.slice(at + 1).toLowerCase();
}

/** Bare host from an org record's `website` field, in any of the formats the vault uses. */
export function domainFromWebsite(value: unknown): string {
	if (typeof value !== 'string') return '';
	let v = unquote(value).toLowerCase();
	v = v.replace(/^[a-z]+:\/\//,'').replace(/^www\./, '');
	return v.split(/[/?#]/)[0] ?? '';
}