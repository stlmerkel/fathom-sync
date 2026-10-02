import { normalizeEmail } from './normalize';

export interface DirectoryPerson {
	firstName: string;
	lastName: string;
	email: string;
	jobTitle: string;
	department: string;
	phone: string;
	terminated: boolean;
}

/** RFC 4180-style CSV: quoted fields, doubled quotes, CRLF or LF rows. */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;

	for (let i = 0; i < text.length; i++) {
		const c = text.charAt(i);
		if (inQuotes) {
			if (c === '"') {
				if (text.charAt(i + 1) === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += c;
			}
		} else if (c === '"') {
			inQuotes = true;
		} else if (c === ',') {
			row.push(field);
			field = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && text.charAt(i + 1) === '\n') i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else {
			field += c;
		}
	}
	if (field !== '' || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter(r => !(r.length === 1 && r[0] === ''));
}

const ENTITIES: Record<string, string> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&apos;': "'",
	'&#39;': "'",
};

export function decodeEntities(s: string): string {
	return s.replace(/&(amp|lt|gt|quot|apos|#39);/g, m => ENTITIES[m] ?? m);
}

export function parseDirectory(text: string): Map<string, DirectoryPerson> {
	const out = new Map<string, DirectoryPerson>();
	const rows = parseCsv(text.replace(/^\uFEFF/, ''));
	const header = rows[0];
	if (!header) return out;

	const col = (name: string) => header.indexOf(name);
	const idx = {
		first: col('firstName'),
		last: col('lastName'),
		email: col('email'),
		title: col('jobTitle'),
		dept: col('departmentDesc1'),
		phone: col('phone'),
		term: col('HR_EffectiveTerminationDate'),
	};
	if (idx.email === -1) return out;

	const get = (r: string[], i: number) => (i === -1 ? '' : decodeEntities((r[i] ?? '').trim()));

	for (const r of rows.slice(1)) {
		const email = normalizeEmail(get(r, idx.email));
		if (!email) continue;
		const person: DirectoryPerson = {
			firstName: get(r, idx.first),
			lastName: get(r, idx.last),
			email,
			jobTitle: get(r, idx.title),
			department: get(r, idx.dept),
			phone: get(r, idx.phone),
			terminated: get(r, idx.term) !== '',
		};
		const existing = out.get(email);
		if (!existing || (existing.terminated && !person.terminated)) out.set(email, person);
	}
	return out;
}
