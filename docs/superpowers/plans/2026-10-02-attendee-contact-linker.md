# Attendee → Contact Linker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make fathom-sync link meeting attendees to Contact records automatically (on sync and through a backfill command), create Maryville contacts from the faculty-staff directory, and ask about externals once.

**Architecture:** The matching rules are pure TypeScript modules under `src/attendees/` (normalize, directory, related, contactTemplate, planner, report), unit-tested with Vitest and with no Obsidian import. A thin Obsidian layer (`linker.ts`, `ReviewModal.ts`) builds the contact index from the metadata cache, executes the plan through `vault.create` / `vault.process`, and writes the preview and the log. `main.ts` calls the linker after sync and adds two commands and the settings.

**Tech Stack:** TypeScript 5.7, Obsidian plugin API, esbuild 0.24, Vitest 3 (new dev dependency), Node 22.

**Spec:** `docs/superpowers/specs/2026-10-02-attendee-contact-linker-design.md`

## Global Constraints

- Link line format, exactly: `Related: [[Name]]`, one per line, inserted directly after the closing frontmatter `---` and after any `Related:` lines already there.
- Match by email only (trimmed, lowercased). Never by display name.
- Never overwrite an existing file. Contacts are created with `vault.create` only; existing notes change only through `vault.process`, and only by inserting lines.
- Created contacts carry `vault: cursus-opus` (the running vault's name) plus every field of `90-SYSTEM/templates/Contact.md`, and the `<!-- contact-related-queries v1 -->` block with the person's email in the Meetings query.
- The directory organization defaults to `Maryville University`. Externals link `[[Org]]` only when an organization record with a matching `website` domain exists. No org records are created.
- Linker failures never fail a sync.
- Preview and backfill refuse to run while the `selfEmails` setting is empty.
- Defaults: contacts folder `30-REFERENCE/Contacts`, directory CSV `70-PROJECTS/Maryville Institutional AI/faculty-staff/faculty-staff.csv`, report folder `90-SYSTEM/fathom-sync`, link on sync **on**.
- `tsconfig.json` targets ES6 with lib up to ES2017: no `replaceAll`, `Object.fromEntries`, `Array.prototype.flat`, or optional catch binding helpers beyond what TS downlevels.
- Pure modules (`normalize`, `directory`, `related`, `contactTemplate`, `planner`, `report`) must not import `obsidian`; Vitest cannot resolve it.
- Write invisible characters (BOM, NBSP, zero-width, U+2028/U+2029) as `\uXXXX` escapes in source and tests, never as literal characters. Literals get silently dropped when code is copied, which leaves tests passing vacuously, and a literal U+2028/U+2029 inside a regex literal is a syntax error.
- `vault.process` needs Obsidian 1.1.0, so `manifest.json` `minAppVersion` becomes `1.1.0`.

## Review Focus

1. **Attendee with an empty or missing email** (Fathom invitees without an address, or `email: ""` in old frontmatter). Expect it to be skipped silently, with no crash, no link and no queue entry. Pinned in Task 5.
2. **The same person listed twice in one meeting** (`Merkel, Brian` and `Brian Merkel` with one address, as in the 2024-09-10 note). Expect one `Related:` line, not two, and one created contact. Pinned in Task 5.
3. **A note with CRLF line endings or a BOM before `---`** (files edited on another machine through Synology). Expect the link inserted under the frontmatter with the original line endings kept. Pinned in Task 3.
4. **A name with characters illegal in a filename** (`Smith/Jones`, `O'Brien: Admissions`). Expect a sanitized filename, with the planner's name-collision check using the sanitized name. Pinned in Task 4.
5. **Contact frontmatter where `email` isn't a plain string** (quoted `'x@y.edu'`, a number, a list, or blank). Expect quotes stripped and non-strings ignored, so the record simply doesn't match. Pinned in Task 1.

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `package.json` | Modify | Add `vitest` dev dependency and `test` script; bump version |
| `manifest.json` | Modify | Bump version to 1.5.0 and `minAppVersion` to 1.1.0 |
| `src/attendees/normalize.ts` | Create | Email and domain normalisation |
| `src/attendees/directory.ts` | Create | CSV parsing → `Map<email, DirectoryPerson>` |
| `src/attendees/related.ts` | Create | Insert `Related:` lines into note text |
| `src/attendees/contactTemplate.ts` | Create | Filenames, display-name splitting, contact note rendering |
| `src/attendees/planner.ts` | Create | Types shared by the feature, plus `plan()` |
| `src/attendees/report.ts` | Create | Render preview, log section, summary line |
| `src/attendees/linker.ts` | Create | Obsidian adapter: index, directory load, note reading, run/approve |
| `src/attendees/ReviewModal.ts` | Create | The externals review modal |
| `src/main.ts` | Modify | Settings, sync hook, two commands, settings tab section |
| `tests/*.test.ts` | Create | Unit tests for the six pure modules |
| `README.md` | Modify | Document the feature |

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd ~/local-dev-projects/fathom-sync
git checkout -b feature/attendee-contact-linker
```

- [ ] **Step 2: Commit the spec and plan**

The spec is untracked on `main`; it travels with the branch. It has no `github_issues`, so commits carry no `Refs #N` trailer.

```bash
git add docs/superpowers/specs/2026-10-02-attendee-contact-linker-design.md docs/superpowers/plans/2026-10-02-attendee-contact-linker.md
git commit -m "docs: attendee contact linker design and plan"
```

---

### Task 1: Vitest setup and `normalize.ts`

**Files:**
- Modify: `package.json`
- Create: `src/attendees/normalize.ts`
- Test: `tests/normalize.test.ts`

**Interfaces:**
- Produces: `normalizeEmail(value: unknown): string` (returns `''` for anything that isn't an email), `domainOf(email: string): string`, `domainFromWebsite(value: unknown): string`

- [ ] **Step 1: Install Vitest and add the test script**

```bash
npm install -D vitest@3
```

Then edit `package.json` `scripts` to:

```json
"scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
    "test": "vitest run"
}
```

- [ ] **Step 2: Write the failing test**

`tests/normalize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { domainFromWebsite, domainOf, normalizeEmail } from '../src/attendees/normalize';

describe('normalizeEmail', () => {
	it('trims and lowercases', () => {
		expect(normalizeEmail('  SBronson@Maryville.EDU ')).toBe('sbronson@maryville.edu');
	});
	it('strips surrounding quotes left by YAML', () => {
		expect(normalizeEmail("'sbronson@maryville.edu'")).toBe('sbronson@maryville.edu');
		expect(normalizeEmail('"sbronson@maryville.edu"')).toBe('sbronson@maryville.edu');
	});
	it('strips NBSP, zero-width characters and a BOM that trim() leaves behind', () => {
		expect(normalizeEmail('\uFEFFsbronson@maryville.edu\u00A0')).toBe('sbronson@maryville.edu');
		expect(normalizeEmail('sbron\u200Bson@maryville.edu')).toBe('sbronson@maryville.edu');
	});
	it('returns empty for non-strings, blanks and non-emails', () => {
		expect(normalizeEmail(undefined)).toBe('');
		expect(normalizeEmail(null)).toBe('');
		expect(normalizeEmail(42)).toBe('');
		expect(normalizeEmail(['a@b.com'])).toBe('');
		expect(normalizeEmail('')).toBe('');
		expect(normalizeEmail('Sara Bronson')).toBe('');
	});
});

describe('domainOf', () => {
	it('returns the part after the last @', () => {
		expect(domainOf('mohammad.haque@propeller.cloud')).toBe('propeller.cloud');
	});
	it('returns empty when there is no @', () => {
		expect(domainOf('nobody')).toBe('');
	});
});

describe('domainFromWebsite', () => {
	it.each([
		['www.capacity.com', 'capacity.com'],
		["'burstiq.com'", 'burstiq.com'],
		['https://www.1edtech.org/', '1edtech.org'],
		['adobe.com', 'adobe.com'],
		['http://Example.com/path?q=1', 'example.com'],
	])('%s → %s', (input, expected) => {
		expect(domainFromWebsite(input)).toBe(expected);
	});
	it('returns empty for non-strings and blanks', () => {
		expect(domainFromWebsite(undefined)).toBe('');
		expect(domainFromWebsite('')).toBe('');
	});
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL, `Failed to resolve import "../src/attendees/normalize"`

- [ ] **Step 4: Write the implementation**

`src/attendees/normalize.ts`:

```ts
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
	v = v.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
	return v.split(/[/?#]/)[0] ?? '';
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS (all `normalize` tests)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/attendees/normalize.ts tests/normalize.test.ts
git commit -m "feat(attendees): add vitest and email/domain normalisation"
```

---

### Task 2: `directory.ts`, the faculty-staff CSV

**Files:**
- Create: `src/attendees/directory.ts`
- Test: `tests/directory.test.ts`

**Interfaces:**
- Consumes: `normalizeEmail` (Task 1)
- Produces:
  ```ts
  export interface DirectoryPerson {
  	firstName: string; lastName: string; email: string;
  	jobTitle: string; department: string; phone: string; terminated: boolean;
  }
  export function parseCsv(text: string): string[][];
  export function decodeEntities(s: string): string;
  export function parseDirectory(text: string): Map<string, DirectoryPerson>;
  ```

- [ ] **Step 1: Write the failing test**

`tests/directory.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeEntities, parseCsv, parseDirectory } from '../src/attendees/directory';

const HEADER = '"ID","firstName","lastName","jobTitle","email","phone","departmentDesc1","HR_EffectiveTerminationDate"';

describe('parseCsv', () => {
	it('handles quoted fields, embedded commas and doubled quotes', () => {
		expect(parseCsv('a,"b, c","say ""hi"""\n1,2,3')).toEqual([
			['a', 'b, c', 'say "hi"'],
			['1', '2', '3'],
		]);
	});
	it('handles CRLF and a trailing newline', () => {
		expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
	});
});

describe('decodeEntities', () => {
	it('decodes the entities the directory export uses', () => {
		expect(decodeEntities('Center for Teaching &amp; Learning')).toBe('Center for Teaching & Learning');
		expect(decodeEntities('&lt;x&gt; &quot;y&quot; &#39;z&#39;')).toBe(`<x> "y" 'z'`);
	});
});

describe('parseDirectory', () => {
	it('maps rows by normalised email', () => {
		const csv = [
			HEADER,
			'"1",Mary Ellen,Finch,Senior Associate,MFinch@maryville.edu,"314.529.9400",Center for Teaching &amp; Learning,""',
		].join('\n');
		const dir = parseDirectory(csv);
		expect(dir.get('mfinch@maryville.edu')).toEqual({
			firstName: 'Mary Ellen',
			lastName: 'Finch',
			email: 'mfinch@maryville.edu',
			jobTitle: 'Senior Associate',
			department: 'Center for Teaching & Learning',
			phone: '314.529.9400',
			terminated: false,
		});
	});
	it('marks a row with a termination date as terminated', () => {
		const csv = [HEADER, '"2",Old,Timer,Clerk,old@maryville.edu,"","Admin","2020-05-01"'].join('\n');
		expect(parseDirectory(csv).get('old@maryville.edu')?.terminated).toBe(true);
	});
	it('prefers a current row over a terminated one for the same email', () => {
		const csv = [
			HEADER,
			'"3",Pat,Lee,Old Title,pat@maryville.edu,"","A","2019-01-01"',
			'"4",Pat,Lee,New Title,pat@maryville.edu,"","B",""',
		].join('\n');
		expect(parseDirectory(csv).get('pat@maryville.edu')?.jobTitle).toBe('New Title');
	});
	it('skips rows without an email and strips a BOM', () => {
		const csv = '\uFEFF' + [HEADER, '"5",No,Email,Title,,"","X",""'].join('\n');
		expect(parseDirectory(csv).size).toBe(0);
	});
	it('returns an empty map when the email column is missing', () => {
		expect(parseDirectory('"firstName","lastName"\nA,B').size).toBe(0);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/directory.test.ts`
Expected: FAIL, `Failed to resolve import "../src/attendees/directory"`

- [ ] **Step 3: Write the implementation**

`src/attendees/directory.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/directory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/attendees/directory.ts tests/directory.test.ts
git commit -m "feat(attendees): parse the faculty-staff directory CSV"
```

---

### Task 3: `related.ts`, inserting `Related:` lines

**Files:**
- Create: `src/attendees/related.ts`
- Test: `tests/related.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface RelatedResult { content: string; added: string[]; hasFrontmatter: boolean }
  export function insertRelatedLines(content: string, names: string[]): RelatedResult;
  ```
  `added` holds the names actually inserted, in order. When `hasFrontmatter` is false, `content` is returned unchanged.

- [ ] **Step 1: Write the failing test**

`tests/related.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { insertRelatedLines } from '../src/attendees/related';

const NOTE = ['---', 'vault: cursus-opus', 'type: meeting', '---', '', '## Summary', 'Body'].join('\n');

describe('insertRelatedLines', () => {
	it('inserts directly after the closing frontmatter fence', () => {
		const r = insertRelatedLines(NOTE, ['Sara Bronson', 'Princess Baehler']);
		expect(r.hasFrontmatter).toBe(true);
		expect(r.added).toEqual(['Sara Bronson', 'Princess Baehler']);
		expect(r.content.split('\n').slice(3, 6)).toEqual([
			'---',
			'Related: [[Sara Bronson]]',
			'Related: [[Princess Baehler]]',
		]);
	});

	it('appends after existing Related lines and skips names already linked', () => {
		const existing = NOTE.replace('---\n\n', '---\nRelated: [[Josh Tepen]]\n\n');
		const r = insertRelatedLines(existing, ['josh tepen', 'Scott Obermeyer']);
		expect(r.added).toEqual(['Scott Obermeyer']);
		expect(r.content.split('\n').slice(3, 6)).toEqual([
			'---',
			'Related: [[Josh Tepen]]',
			'Related: [[Scott Obermeyer]]',
		]);
	});

	it('recognises aliased links as already present', () => {
		const existing = NOTE.replace('---\n\n', '---\nRelated: [[Josh Tepen|Josh]]\n\n');
		expect(insertRelatedLines(existing, ['Josh Tepen']).added).toEqual([]);
	});

	it('is idempotent', () => {
		const once = insertRelatedLines(NOTE, ['Sara Bronson']).content;
		const twice = insertRelatedLines(once, ['Sara Bronson']);
		expect(twice.added).toEqual([]);
		expect(twice.content).toBe(once);
	});

	it('dedupes names within one call', () => {
		expect(insertRelatedLines(NOTE, ['Sara Bronson', 'Sara Bronson']).added).toEqual(['Sara Bronson']);
	});

	it('leaves a note without frontmatter unchanged and reports it', () => {
		const plain = '# Old meeting\nRelated text';
		const r = insertRelatedLines(plain, ['Sara Bronson']);
		expect(r).toEqual({ content: plain, added: [], hasFrontmatter: false });
	});

	it('leaves a note with an unclosed frontmatter fence unchanged', () => {
		const broken = '---\nvault: cursus-opus\n## Summary';
		expect(insertRelatedLines(broken, ['A B']).hasFrontmatter).toBe(false);
	});

	// Review Focus 3
	it('keeps CRLF line endings', () => {
		const crlf = NOTE.split('\n').join('\r\n');
		const r = insertRelatedLines(crlf, ['Sara Bronson']);
		expect(r.content).toContain('---\r\nRelated: [[Sara Bronson]]\r\n');
		expect(r.content.includes('\n') && !/[^\r]\n/.test(r.content)).toBe(true);
	});

	it('handles a BOM before the opening fence', () => {
		const bom = '\uFEFF' + NOTE;
		const r = insertRelatedLines(bom, ['Sara Bronson']);
		expect(r.hasFrontmatter).toBe(true);
		expect(r.content.startsWith('\uFEFF---')).toBe(true);
		expect(r.added).toEqual(['Sara Bronson']);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/related.test.ts`
Expected: FAIL, `Failed to resolve import "../src/attendees/related"`

- [ ] **Step 3: Write the implementation**

`src/attendees/related.ts`:

```ts
// Matches `Related: [[Name]]`, `Related: [[Name|alias]]`, `Related: [[Name#h]]`.
const RELATED_RE = /^Related:\s*\[\[([^\]|#]+)/;

export interface RelatedResult {
	content: string;
	added: string[];
	hasFrontmatter: boolean;
}

export function insertRelatedLines(content: string, names: string[]): RelatedResult {
	const unchanged: RelatedResult = { content, added: [], hasFrontmatter: false };
	const eol = content.includes('\r\n') ? '\r\n' : '\n';
	const lines = content.split(/\r?\n/);

	if ((lines[0] ?? '').replace(/^\uFEFF/, '').trim() !== '---') return unchanged;

	let close = -1;
	for (let i = 1; i < lines.length; i++) {
		if ((lines[i] ?? '').trim() === '---') {
			close = i;
			break;
		}
	}
	if (close === -1) return unchanged;

	const linked = new Set<string>();
	for (const line of lines) {
		const m = RELATED_RE.exec(line);
		if (m && m[1]) linked.add(m[1].trim().toLowerCase());
	}

	const added: string[] = [];
	for (const name of names) {
		const key = name.trim().toLowerCase();
		if (!key || linked.has(key)) continue;
		linked.add(key);
		added.push(name.trim());
	}
	if (added.length === 0) return { content, added, hasFrontmatter: true };

	let insertAt = close + 1;
	while (insertAt < lines.length && RELATED_RE.test(lines[insertAt] ?? '')) insertAt++;

	lines.splice(insertAt, 0, ...added.map(n => `Related: [[${n}]]`));
	return { content: lines.join(eol), added, hasFrontmatter: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/related.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/attendees/related.ts tests/related.test.ts
git commit -m "feat(attendees): insert Related lines under note frontmatter"
```

---

### Task 4: `contactTemplate.ts`, contact notes

**Files:**
- Create: `src/attendees/contactTemplate.ts`
- Test: `tests/contactTemplate.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface NewContact {
  	firstName: string; lastName: string; email: string;
  	title: string; department: string; phone: string;
  	organization: string;      // '' when unknown
  	orgHasRecord: boolean;     // true → render [[organization]]
  	status: 'active' | 'inactive';
  	vault: string;             // e.g. 'cursus-opus'
  	date: string;              // YYYY-MM-DD
  	provenance: string;        // the Notes line, without the leading '- '
  }
  export function sanitizeFileName(name: string): string;
  export function contactFileName(firstName: string, lastName: string): string;
  export function splitDisplayName(name: string, email: string): { firstName: string; lastName: string };
  export function renderContact(c: NewContact): string;
  ```

- [ ] **Step 1: Write the failing test**

`tests/contactTemplate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
	contactFileName,
	renderContact,
	sanitizeFileName,
	splitDisplayName,
	type NewContact,
} from '../src/attendees/contactTemplate';

const BASE: NewContact = {
	firstName: 'Mary Ellen',
	lastName: 'Finch',
	email: 'mfinch@maryville.edu',
	title: 'Senior Associate: CTL',
	department: 'Center for Teaching & Learning',
	phone: '314.529.9400',
	organization: 'Maryville University',
	orgHasRecord: true,
	status: 'active',
	vault: 'cursus-opus',
	date: '2026-10-02',
	provenance: 'Created from faculty-staff directory by fathom-sync (2026-10-02)',
};

describe('file names', () => {
	it('joins first and last name', () => {
		expect(contactFileName('Sara', 'Bronson')).toBe('Sara Bronson');
	});
	it('handles a missing last name', () => {
		expect(contactFileName('Cher', '')).toBe('Cher');
	});
	// Review Focus 4
	it('removes characters illegal in filenames or wikilinks', () => {
		expect(sanitizeFileName('Smith/Jones')).toBe('Smith-Jones');
		expect(sanitizeFileName("O'Brien: Admissions")).toBe("O'Brien- Admissions");
		expect(sanitizeFileName('A [B] #C ^D |E')).toBe('A -B- -C -D -E');
		expect(contactFileName('  Pat ', ' Lee  ')).toBe('Pat Lee');
	});
});

describe('splitDisplayName', () => {
	it('reverses "Last, First"', () => {
		expect(splitDisplayName('Bronson, Sara E.', 'x@y.z')).toEqual({ firstName: 'Sara E.', lastName: 'Bronson' });
	});
	it('splits on the last space', () => {
		expect(splitDisplayName('Mohammad A. Haque', 'x@y.z')).toEqual({ firstName: 'Mohammad A.', lastName: 'Haque' });
	});
	it('keeps a single word as the first name', () => {
		expect(splitDisplayName('Cher', 'x@y.z')).toEqual({ firstName: 'Cher', lastName: '' });
	});
	it('falls back to the email local part when the name is blank or an email', () => {
		expect(splitDisplayName('', 'jdoe@vendor.com')).toEqual({ firstName: 'jdoe', lastName: '' });
		expect(splitDisplayName('jdoe@vendor.com', 'jdoe@vendor.com')).toEqual({ firstName: 'jdoe', lastName: '' });
	});
});

describe('renderContact', () => {
	const out = renderContact(BASE);

	it('writes the frontmatter fields of the Contact template plus vault', () => {
		for (const key of [
			'vault', 'first_name', 'last_name', 'full_name', 'pronouns', 'email', 'phone', 'linkedin',
			'organization', 'title_position', 'relationship_nature', 'reports_to', 'division',
			'department', 'team', 'location', 'met_through', 'birthday', 'date_created',
			'date_modified', 'document_type', 'status', 'aliases', 'tags',
		]) {
			expect(out).toMatch(new RegExp(`^${key}:`, 'm'));
		}
		expect(out).toMatch(/^vault: cursus-opus$/m);
		expect(out).toMatch(/^document_type: contact$/m);
		expect(out).toMatch(/^email: 'mfinch@maryville.edu'$/m);
		expect(out).toMatch(/^full_name: "Mary Ellen Finch"$/m);
		expect(out).toMatch(/^title_position: "Senior Associate: CTL"$/m);
	});

	it('links the organization when it has a record', () => {
		expect(out).toContain('\n[[Maryville University]]\n');
		expect(out).toContain('| [[Maryville University]] | Senior Associate: CTL | | | active |');
	});

	it('writes plain text and no wikilink when the org has no record', () => {
		const o = renderContact({ ...BASE, orgHasRecord: false, organization: 'Some Vendor' });
		expect(o).not.toContain('[[Some Vendor]]');
		expect(o).toContain('\nSome Vendor\n');
	});

	it('omits the org line and affiliation row when there is no organization', () => {
		const o = renderContact({ ...BASE, organization: '', orgHasRecord: false });
		expect(o).not.toContain('| active |');
		expect(o).toContain('# Mary Ellen Finch\nSenior Associate: CTL\nmfinch@maryville.edu\n');
	});

	it('carries the related-queries block with the email filled in', () => {
		expect(out).toContain('<!-- contact-related-queries v1 -->');
		expect(out).toContain('WHERE contains(attendees.email, "mfinch@maryville.edu")');
		expect(out).toContain('<!-- /contact-related-queries -->');
	});

	it('writes the provenance line under Notes', () => {
		expect(out).toContain('## Notes\n- Created from faculty-staff directory by fathom-sync (2026-10-02)');
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/contactTemplate.test.ts`
Expected: FAIL, `Failed to resolve import "../src/attendees/contactTemplate"`

- [ ] **Step 3: Write the implementation**

`src/attendees/contactTemplate.ts`:

```ts
// Reproduces the output of 90-SYSTEM/templates/Contact.md (a Templater +
// Modal Forms template the plugin can't execute), plus the `vault` field.

export interface NewContact {
	firstName: string;
	lastName: string;
	email: string;
	title: string;
	department: string;
	phone: string;
	organization: string;
	orgHasRecord: boolean;
	status: 'active' | 'inactive';
	vault: string;
	date: string;
	provenance: string;
}

/** Strip characters that break filenames or wikilinks. */
export function sanitizeFileName(name: string): string {
	return name
		.replace(/[\\/:*?"<>|#^[\]]/g, '-')
		.replace(/\s+/g, ' ')
		.trim();
}

export function contactFileName(firstName: string, lastName: string): string {
	return sanitizeFileName(`${firstName.trim()} ${lastName.trim()}`);
}

export function splitDisplayName(name: string, email: string): { firstName: string; lastName: string } {
	const n = name.trim();
	if (!n || n.includes('@')) {
		return { firstName: email.split('@')[0] ?? '', lastName: '' };
	}
	const comma = n.indexOf(',');
	if (comma !== -1) {
		return { firstName: n.slice(comma + 1).trim(), lastName: n.slice(0, comma).trim() };
	}
	const space = n.lastIndexOf(' ');
	if (space === -1) return { firstName: n, lastName: '' };
	return { firstName: n.slice(0, space).trim(), lastName: n.slice(space + 1).trim() };
}

/** YAML scalar: blank stays blank, anything else is double-quoted (JSON is valid YAML). */
function y(s: string): string {
	return s === '' ? '' : JSON.stringify(s);
}

export function renderContact(c: NewContact): string {
	const fullName = `${c.firstName} ${c.lastName}`.trim();
	const orgRef = c.organization === '' ? '' : c.orgHasRecord ? `[[${c.organization}]]` : c.organization;

	const lines: string[] = [
		'---',
		`vault: ${c.vault}`,
		`first_name: ${y(c.firstName)}`,
		`last_name: ${y(c.lastName)}`,
		`full_name: ${y(fullName)}`,
		'pronouns:',
		`email: '${c.email}'`,
		`phone: ${y(c.phone)}`,
		'linkedin:',
		`organization: ${y(c.organization)}`,
		`title_position: ${y(c.title)}`,
		'relationship_nature:',
		'reports_to:',
		'division:',
		`department: ${y(c.department)}`,
		'team:',
		'location:',
		'met_through:',
		'birthday: YYYY-MM-DD',
		`date_created: ${c.date}`,
		`date_modified: ${c.date}`,
		'document_type: contact',
		`status: ${c.status}`,
		'aliases:',
		'tags: contact',
		'---',
		`# ${fullName}`,
	];
	if (c.title) lines.push(c.title);
	if (orgRef) lines.push(orgRef);
	lines.push(
		c.email,
		'___',
		'## Affiliations',
		'',
		'| Organization | Role | Start | End | Status |',
		'|---|---|---|---|---|',
	);
	if (orgRef) lines.push(`| ${orgRef} | ${c.title} | | | active |`);
	lines.push(
		'',
		'___',
		'## Notes',
		`- ${c.provenance}`,
		'',
		'___',
		'## Related',
		'',
		'<!-- contact-related-queries v1 -->',
		'',
		'### Meetings',
		'```dataview',
		'TABLE WITHOUT ID file.link AS Meeting, date AS Date, fathom_url AS Fathom',
		'FROM "20-PERIODIC/meetings"',
		`WHERE contains(attendees.email, "${c.email}")`,
		'SORT date DESC',
		'LIMIT 25',
		'```',
		'',
		'### Mentioned In',
		'```dataview',
		'LIST',
		'FROM [[]]',
		'WHERE file.folder != "20-PERIODIC/meetings"',
		'SORT file.mtime DESC',
		'LIMIT 25',
		'```',
		'',
		'<!-- /contact-related-queries -->',
		'',
	);
	return lines.join('\n');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/contactTemplate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/attendees/contactTemplate.ts tests/contactTemplate.test.ts
git commit -m "feat(attendees): render contact notes matching the vault template"
```

---

### Task 5: `planner.ts`, the matching rules

**Files:**
- Create: `src/attendees/planner.ts`
- Test: `tests/planner.test.ts`

**Interfaces:**
- Consumes: `normalizeEmail`, `domainOf` (Task 1); `DirectoryPerson` (Task 2); `contactFileName`, `splitDisplayName` (Task 4)
- Produces:
  ```ts
  export interface Attendee { name: string; email: string }
  export interface MeetingInput { path: string; attendees: Attendee[]; recordedByEmail?: string }
  export interface ExistingContact { basename: string; path: string; email: string }
  export interface ContactIndex {
  	byEmail: Map<string, string>;            // email → contact basename
  	byName: Map<string, ExistingContact>;    // lowercased basename → record (person records only)
  	orgByDomain: Map<string, string>;        // domain → org basename
  	orgNames: Set<string>;                   // lowercased org basenames
  }
  export interface PlanOptions { selfEmails: string[]; ignoredEmails: string[]; directoryOrg: string }
  export interface PlannedCreate { basename: string; email: string; person: DirectoryPerson; meetings: string[] }
  export interface QueuedPerson {
  	kind: 'external' | 'collision';
  	basename: string; firstName: string; lastName: string; email: string; domain: string;
  	org: string | null; meetings: string[]; existingPath: string | null; person: DirectoryPerson | null;
  }
  export interface LinkPlan { links: Map<string, string[]>; creates: PlannedCreate[]; queue: QueuedPerson[] }
  export function plan(meetings: MeetingInput[], index: ContactIndex, directory: Map<string, DirectoryPerson> | null, opts: PlanOptions): LinkPlan;
  ```
  `links` already includes the basenames of planned creates. Queued people are **not** in `links`; they are linked through `QueuedPerson.meetings` once approved.

- [ ] **Step 1: Write the failing test**

`tests/planner.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { DirectoryPerson } from '../src/attendees/directory';
import { plan, type ContactIndex, type MeetingInput, type PlanOptions } from '../src/attendees/planner';

function index(overrides: Partial<ContactIndex> = {}): ContactIndex {
	return {
		byEmail: new Map([['sbronson@maryville.edu', 'Sara Bronson']]),
		byName: new Map([
			['sara bronson', { basename: 'Sara Bronson', path: 'C/Sara Bronson.md', email: 'sbronson@maryville.edu' }],
			['pat lee', { basename: 'Pat Lee', path: 'C/Pat Lee.md', email: 'other@elsewhere.com' }],
		]),
		orgByDomain: new Map([['propeller.cloud', 'Propeller']]),
		orgNames: new Set(['propeller', 'maryville university']),
		...overrides,
	};
}

function person(email: string, first: string, last: string): DirectoryPerson {
	return { firstName: first, lastName: last, email, jobTitle: 'T', department: 'D', phone: '', terminated: false };
}

const DIR = new Map<string, DirectoryPerson>([
	['mfinch@maryville.edu', person('mfinch@maryville.edu', 'Mary Ellen', 'Finch')],
	['plee@maryville.edu', person('plee@maryville.edu', 'Pat', 'Lee')],
]);

const OPTS: PlanOptions = { selfEmails: ['bmerkel@maryville.edu'], ignoredEmails: [], directoryOrg: 'Maryville University' };

const m = (path: string, ...emails: string[]): MeetingInput => ({
	path,
	attendees: emails.map(e => ({ name: e.split('@')[0] ?? '', email: e })),
});

describe('plan', () => {
	it('rule 1: skips the user’s own email', () => {
		const p = plan([m('a.md', 'BMerkel@maryville.edu')], index(), DIR, OPTS);
		expect(p.links.size).toBe(0);
		expect(p.queue).toEqual([]);
	});

	it('rule 1: with no selfEmails, falls back to the meeting’s recordedByEmail', () => {
		const meeting = { ...m('a.md', 'bmerkel@maryville.edu'), recordedByEmail: 'bmerkel@maryville.edu' };
		const p = plan([meeting], index(), DIR, { ...OPTS, selfEmails: [] });
		expect(p.queue).toEqual([]);
		expect(p.links.size).toBe(0);
	});

	it('rule 2: skips ignored emails', () => {
		const p = plan([m('a.md', 'x@vendor.com')], index(), DIR, { ...OPTS, ignoredEmails: ['X@vendor.com'] });
		expect(p.queue).toEqual([]);
	});

	it('rule 3: links an existing contact by email', () => {
		const p = plan([m('a.md', 'SBronson@maryville.edu')], index(), DIR, OPTS);
		expect(p.links.get('a.md')).toEqual(['Sara Bronson']);
	});

	it('rule 4: plans a directory create and links it', () => {
		const p = plan([m('a.md', 'mfinch@maryville.edu')], index(), DIR, OPTS);
		expect(p.creates).toHaveLength(1);
		expect(p.creates[0]?.basename).toBe('Mary Ellen Finch');
		expect(p.links.get('a.md')).toEqual(['Mary Ellen Finch']);
	});

	it('rule 4: one directory person across several meetings is created once and linked everywhere', () => {
		const p = plan([m('a.md', 'mfinch@maryville.edu'), m('b.md', 'mfinch@maryville.edu')], index(), DIR, OPTS);
		expect(p.creates).toHaveLength(1);
		expect(p.creates[0]?.meetings).toEqual(['a.md', 'b.md']);
		expect(p.links.get('b.md')).toEqual(['Mary Ellen Finch']);
	});

	it('rule 5: queues a name collision instead of creating', () => {
		const p = plan([m('a.md', 'plee@maryville.edu')], index(), DIR, OPTS);
		expect(p.creates).toEqual([]);
		expect(p.links.size).toBe(0);
		expect(p.queue).toHaveLength(1);
		expect(p.queue[0]).toMatchObject({ kind: 'collision', basename: 'Pat Lee', existingPath: 'C/Pat Lee.md' });
	});

	it('rule 6: queues an external with the org matched by domain', () => {
		const p = plan(
			[{ path: 'a.md', attendees: [{ name: 'Mohammad A. Haque', email: 'mohammad.haque@propeller.cloud' }] }],
			index(),
			DIR,
			OPTS,
		);
		expect(p.queue[0]).toMatchObject({
			kind: 'external',
			basename: 'Mohammad A. Haque',
			domain: 'propeller.cloud',
			org: 'Propeller',
			meetings: ['a.md'],
		});
	});

	it('rule 6: an external from an unknown domain has no org', () => {
		const p = plan([m('a.md', 'someone@unknown.io')], index(), DIR, OPTS);
		expect(p.queue[0]?.org).toBeNull();
	});

	it('an external in several meetings is queued once with every meeting', () => {
		const p = plan([m('a.md', 'someone@unknown.io'), m('b.md', 'someone@unknown.io')], index(), DIR, OPTS);
		expect(p.queue).toHaveLength(1);
		expect(p.queue[0]?.meetings).toEqual(['a.md', 'b.md']);
	});

	it('without a directory, Maryville people fall through to the queue', () => {
		const p = plan([m('a.md', 'mfinch@maryville.edu')], index(), null, OPTS);
		expect(p.creates).toEqual([]);
		expect(p.queue[0]?.kind).toBe('external');
	});

	it('two different emails that would share a filename: the second is a collision', () => {
		const dir = new Map(DIR);
		dir.set('mfinch2@maryville.edu', person('mfinch2@maryville.edu', 'Mary Ellen', 'Finch'));
		const p = plan([m('a.md', 'mfinch@maryville.edu', 'mfinch2@maryville.edu')], index(), dir, OPTS);
		expect(p.creates).toHaveLength(1);
		expect(p.queue[0]).toMatchObject({ kind: 'collision', email: 'mfinch2@maryville.edu', existingPath: null });
	});

	// Review Focus 1
	it('skips attendees with empty or missing emails', () => {
		const meeting: MeetingInput = {
			path: 'a.md',
			attendees: [{ name: 'Ghost', email: '' }, { name: 'Nobody', email: undefined as unknown as string }],
		};
		const p = plan([meeting], index(), DIR, OPTS);
		expect(p.links.size).toBe(0);
		expect(p.queue).toEqual([]);
		expect(p.creates).toEqual([]);
	});

	// Review Focus 2
	it('the same email listed twice in one meeting yields one link and one create', () => {
		const meeting: MeetingInput = {
			path: 'a.md',
			attendees: [
				{ name: 'Finch, Mary Ellen', email: 'mfinch@maryville.edu' },
				{ name: 'Mary Ellen Finch', email: 'MFinch@maryville.edu' },
				{ name: 'Bronson, Sara E.', email: 'sbronson@maryville.edu' },
				{ name: 'Sara Bronson', email: 'sbronson@maryville.edu' },
			],
		};
		const p = plan([meeting], index(), DIR, OPTS);
		expect(p.links.get('a.md')).toEqual(['Mary Ellen Finch', 'Sara Bronson']);
		expect(p.creates).toHaveLength(1);
		expect(p.creates[0]?.meetings).toEqual(['a.md']);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/planner.test.ts`
Expected: FAIL, `Failed to resolve import "../src/attendees/planner"`

- [ ] **Step 3: Write the implementation**

`src/attendees/planner.ts`:

```ts
import { contactFileName, splitDisplayName } from './contactTemplate';
import type { DirectoryPerson } from './directory';
import { domainOf, normalizeEmail } from './normalize';

export interface Attendee {
	name: string;
	email: string;
}

export interface MeetingInput {
	path: string;
	attendees: Attendee[];
	recordedByEmail?: string;
}

export interface ExistingContact {
	basename: string;
	path: string;
	email: string;
}

export interface ContactIndex {
	byEmail: Map<string, string>;
	byName: Map<string, ExistingContact>;
	orgByDomain: Map<string, string>;
	orgNames: Set<string>;
}

export interface PlanOptions {
	selfEmails: string[];
	ignoredEmails: string[];
	directoryOrg: string;
}

export interface PlannedCreate {
	basename: string;
	email: string;
	person: DirectoryPerson;
	meetings: string[];
}

export interface QueuedPerson {
	kind: 'external' | 'collision';
	basename: string;
	firstName: string;
	lastName: string;
	email: string;
	domain: string;
	org: string | null;
	meetings: string[];
	existingPath: string | null;
	person: DirectoryPerson | null;
}

export interface LinkPlan {
	links: Map<string, string[]>;
	creates: PlannedCreate[];
	queue: QueuedPerson[];
}

function pushUnique(list: string[], value: string): void {
	if (!list.includes(value)) list.push(value);
}

export function plan(
	meetings: MeetingInput[],
	index: ContactIndex,
	directory: Map<string, DirectoryPerson> | null,
	opts: PlanOptions,
): LinkPlan {
	const self = new Set(opts.selfEmails.map(normalizeEmail).filter(Boolean));
	const ignored = new Set(opts.ignoredEmails.map(normalizeEmail).filter(Boolean));

	const links = new Map<string, string[]>();
	const creates = new Map<string, PlannedCreate>();
	const queue = new Map<string, QueuedPerson>();
	// Filenames claimed during this run (lowercased basename → email).
	const claimed = new Map<string, string>();

	const addLink = (path: string, basename: string) => {
		const list = links.get(path) ?? [];
		pushUnique(list, basename);
		links.set(path, list);
	};

	for (const meeting of meetings) {
		const meetingSelf = normalizeEmail(meeting.recordedByEmail);

		for (const attendee of meeting.attendees) {
			const email = normalizeEmail(attendee.email);
			if (!email) continue;
			if (self.size > 0 ? self.has(email) : email === meetingSelf) continue;
			if (ignored.has(email)) continue;

			const known = index.byEmail.get(email);
			if (known) {
				addLink(meeting.path, known);
				continue;
			}

			const planned = creates.get(email);
			if (planned) {
				pushUnique(planned.meetings, meeting.path);
				addLink(meeting.path, planned.basename);
				continue;
			}

			const queued = queue.get(email);
			if (queued) {
				pushUnique(queued.meetings, meeting.path);
				continue;
			}

			const person = directory?.get(email) ?? null;
			const names = person
				? { firstName: person.firstName, lastName: person.lastName }
				: splitDisplayName(attendee.name ?? '', email);
			const basename = contactFileName(names.firstName, names.lastName);
			const key = basename.toLowerCase();
			const domain = domainOf(email);
			const org = person ? opts.directoryOrg : index.orgByDomain.get(domain) ?? null;

			const existing = index.byName.get(key) ?? null;
			const claimedBy = claimed.get(key);
			const entry: QueuedPerson = {
				kind: 'external',
				basename,
				firstName: names.firstName,
				lastName: names.lastName,
				email,
				domain,
				org,
				meetings: [meeting.path],
				existingPath: null,
				person,
			};

			if (!basename || existing || (claimedBy !== undefined && claimedBy !== email)) {
				queue.set(email, { ...entry, kind: 'collision', existingPath: existing?.path ?? null });
				continue;
			}

			claimed.set(key, email);
			if (person) {
				creates.set(email, { basename, email, person, meetings: [meeting.path] });
				addLink(meeting.path, basename);
			} else {
				queue.set(email, entry);
			}
		}
	}

	return { links, creates: [...creates.values()], queue: [...queue.values()] };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/planner.test.ts`
Expected: PASS

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS (normalize, directory, related, contactTemplate, planner)

- [ ] **Step 6: Commit**

```bash
git add src/attendees/planner.ts tests/planner.test.ts
git commit -m "feat(attendees): plan links, directory creates and the review queue"
```

---

### Task 6: `report.ts`, preview, log and summary text

**Files:**
- Create: `src/attendees/report.ts`
- Test: `tests/report.test.ts`

**Interfaces:**
- Consumes: `QueuedPerson` (Task 5)
- Produces:
  ```ts
  export interface RunRecord {
  	title: string;                 // 'sync' | 'backfill' | 'review' | 'preview'
  	when: string;                  // 'YYYY-MM-DD HH:mm'
  	directoryAvailable: boolean;
  	created: { basename: string; source: 'directory' | 'attendee' }[];
  	changed: { path: string; added: string[] }[];
  	queued: QueuedPerson[];
  	ignored: string[];
  	failed: { path: string; error: string }[];
  }
  export function emptyRecord(title: string, when: string, directoryAvailable: boolean): RunRecord;
  export function summaryLine(r: RunRecord): string;
  export function renderPreview(r: RunRecord): string;
  export function renderLogSection(r: RunRecord): string;
  ```

- [ ] **Step 1: Write the failing test**

`tests/report.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { QueuedPerson } from '../src/attendees/planner';
import { emptyRecord, renderLogSection, renderPreview, summaryLine } from '../src/attendees/report';

const queued: QueuedPerson = {
	kind: 'external',
	basename: 'Mohammad A. Haque',
	firstName: 'Mohammad A.',
	lastName: 'Haque',
	email: 'mohammad.haque@propeller.cloud',
	domain: 'propeller.cloud',
	org: 'Propeller',
	meetings: ['m/a.md', 'm/b.md'],
	existingPath: null,
	person: null,
};

function sample() {
	const r = emptyRecord('backfill', '2026-10-02 14:03', true);
	r.created.push({ basename: 'Mary Ellen Finch', source: 'directory' });
	r.changed.push({ path: 'm/a.md', added: ['Mary Ellen Finch', 'Sara Bronson'] });
	r.queued.push(queued);
	r.ignored.push('spam@vendor.com');
	r.failed.push({ path: 'm/bad.md', error: 'no frontmatter' });
	return r;
}

describe('summaryLine', () => {
	it('counts each outcome', () => {
		expect(summaryLine(sample())).toBe('Linked 1 notes · created 1 contacts · 1 to review · 1 failed');
	});
	it('says when the directory was unavailable', () => {
		expect(summaryLine(emptyRecord('sync', 'x', false))).toBe(
			'Linked 0 notes · created 0 contacts · 0 to review · 0 failed · directory CSV unavailable',
		);
	});
});

describe('renderLogSection', () => {
	const out = renderLogSection(sample());
	it('has a dated heading', () => {
		expect(out.startsWith('## 2026-10-02 14:03 — backfill\n')).toBe(true);
	});
	it('lists the exact lines added per file', () => {
		expect(out).toContain('- `m/a.md`\n  - `Related: [[Mary Ellen Finch]]`\n  - `Related: [[Sara Bronson]]`');
	});
	it('lists created contacts with their source, the queue, ignored and failures', () => {
		expect(out).toContain('- [[Mary Ellen Finch]] (directory)');
		expect(out).toContain('- Mohammad A. Haque <mohammad.haque@propeller.cloud> · Propeller · 2 meetings');
		expect(out).toContain('- spam@vendor.com');
		expect(out).toContain('- `m/bad.md`: no frontmatter');
	});
	it('omits empty sections', () => {
		expect(renderLogSection(emptyRecord('sync', 'x', true))).toBe('## x — sync\n\nNothing to do.\n');
	});
});

describe('renderPreview', () => {
	it('is a standalone note that says nothing was written', () => {
		const out = renderPreview(sample());
		expect(out.startsWith('# Attendee link preview\n')).toBe(true);
		expect(out).toContain('Nothing has been written');
		expect(out).toContain('Linked 1 notes · created 1 contacts · 1 to review · 1 failed');
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/report.test.ts`
Expected: FAIL, `Failed to resolve import "../src/attendees/report"`

- [ ] **Step 3: Write the implementation**

`src/attendees/report.ts`:

```ts
import type { QueuedPerson } from './planner';

export interface RunRecord {
	title: string;
	when: string;
	directoryAvailable: boolean;
	created: { basename: string; source: 'directory' | 'attendee' }[];
	changed: { path: string; added: string[] }[];
	queued: QueuedPerson[];
	ignored: string[];
	failed: { path: string; error: string }[];
}

export function emptyRecord(title: string, when: string, directoryAvailable: boolean): RunRecord {
	return { title, when, directoryAvailable, created: [], changed: [], queued: [], ignored: [], failed: [] };
}

export function summaryLine(r: RunRecord): string {
	const parts = [
		`Linked ${r.changed.length} notes`,
		`created ${r.created.length} contacts`,
		`${r.queued.length} to review`,
		`${r.failed.length} failed`,
	];
	if (!r.directoryAvailable) parts.push('directory CSV unavailable');
	return parts.join(' · ');
}

function queuedLine(q: QueuedPerson): string {
	const bits = [`${q.basename} <${q.email}>`];
	if (q.org) bits.push(q.org);
	bits.push(`${q.meetings.length} meeting${q.meetings.length === 1 ? '' : 's'}`);
	if (q.kind === 'collision') bits.push(`name taken${q.existingPath ? ` by \`${q.existingPath}\`` : ' in this run'}`);
	return `- ${bits.join(' · ')}`;
}

function body(r: RunRecord, h: string): string[] {
	const out: string[] = [];
	if (r.created.length) {
		out.push(`${h} Contacts created`, '', ...r.created.map(c => `- [[${c.basename}]] (${c.source})`), '');
	}
	if (r.changed.length) {
		out.push(`${h} Notes changed`, '');
		for (const c of r.changed) {
			out.push(`- \`${c.path}\``, ...c.added.map(n => `  - \`Related: [[${n}]]\``));
		}
		out.push('');
	}
	if (r.queued.length) {
		out.push(`${h} To review`, '', ...r.queued.map(queuedLine), '');
	}
	if (r.ignored.length) {
		out.push(`${h} Ignored`, '', ...r.ignored.map(e => `- ${e}`), '');
	}
	if (r.failed.length) {
		out.push(`${h} Failed`, '', ...r.failed.map(f => `- \`${f.path}\`: ${f.error}`), '');
	}
	return out;
}

export function renderLogSection(r: RunRecord): string {
	const lines = body(r, '###');
	if (lines.length === 0) return `## ${r.when} — ${r.title}\n\nNothing to do.\n`;
	return [`## ${r.when} — ${r.title}`, '', summaryLine(r), '', ...lines].join('\n');
}

export function renderPreview(r: RunRecord): string {
	return [
		'# Attendee link preview',
		'',
		`_Generated ${r.when}. Nothing has been written; run **Link attendees in all meeting notes** to apply._`,
		'',
		summaryLine(r),
		'',
		...body(r, '##'),
	].join('\n');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/report.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/attendees/report.ts tests/report.test.ts
git commit -m "feat(attendees): render preview, log section and summary"
```

---

### Task 7: `linker.ts` and `ReviewModal.ts`, the Obsidian layer

This task has no unit tests: everything here calls the Obsidian API, which Vitest can't load. Its correctness gate is `npm run build` (type check plus bundle) now, and the manual acceptance run in Task 9.

**Files:**
- Create: `src/attendees/linker.ts`
- Create: `src/attendees/ReviewModal.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces:
  ```ts
  export interface LinkerSettings {
  	contactsFolder: string; directoryCsvPath: string; directoryOrg: string;
  	selfEmails: string[]; ignoredEmails: string[]; reportFolder: string;
  }
  export interface RunResult { record: RunRecord; plan: LinkPlan }
  export function readMeetingNotes(app: App, folder: string): MeetingInput[];
  export class AttendeeLinker {
  	constructor(app: App, settings: () => LinkerSettings);
  	run(meetings: MeetingInput[], mode: 'preview' | 'apply', title: string): Promise<RunResult>;
  	approve(selected: QueuedPerson[], unselected: QueuedPerson[]): Promise<RunRecord>;
  }
  export class ReviewModal extends Modal {
  	constructor(app: App, queue: QueuedPerson[], onSubmit: (selected: QueuedPerson[], unselected: QueuedPerson[]) => Promise<void>);
  }
  ```
  `approve` returns a record whose `ignored` lists the emails the caller must add to `settings.ignoredEmails`. The linker never mutates settings itself. `unselected` is empty unless the user chose **Create selected, ignore the rest**, which takes a second click stating how many people it will ignore; plain **Create selected** ignores nobody.

- [ ] **Step 1: Write `linker.ts`**

`src/attendees/linker.ts`:

```ts
import { App, TFile, TFolder, moment, normalizePath } from 'obsidian';
import { renderContact, type NewContact } from './contactTemplate';
import { parseDirectory, type DirectoryPerson } from './directory';
import { domainFromWebsite, normalizeEmail } from './normalize';
import { plan, type ContactIndex, type LinkPlan, type MeetingInput, type QueuedPerson } from './planner';
import { insertRelatedLines } from './related';
import { emptyRecord, renderLogSection, renderPreview, type RunRecord } from './report';

export interface LinkerSettings {
	contactsFolder: string;
	directoryCsvPath: string;
	directoryOrg: string;
	selfEmails: string[];
	ignoredEmails: string[];
	reportFolder: string;
}

export interface RunResult {
	record: RunRecord;
	plan: LinkPlan;
}

const PREVIEW_FILE = 'attendee-link-preview.md';
const LOG_FILE = 'attendee-link-log.md';

function filesUnder(app: App, folder: string): TFile[] {
	const prefix = normalizePath(folder) + '/';
	return app.vault.getMarkdownFiles().filter(f => f.path.startsWith(prefix));
}

function buildIndex(app: App, contactsFolder: string): ContactIndex {
	const index: ContactIndex = { byEmail: new Map(), byName: new Map(), orgByDomain: new Map(), orgNames: new Set() };
	for (const file of filesUnder(app, contactsFolder)) {
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		const docType: unknown = fm?.['document_type'];
		const type = typeof docType === 'string' ? docType.trim() : '';
		if (type === 'contact') {
			const email = normalizeEmail(fm?.['email']);
			if (email) index.byEmail.set(email, file.basename);
			index.byName.set(file.basename.toLowerCase(), { basename: file.basename, path: file.path, email });
		} else if (type === 'organization') {
			index.orgNames.add(file.basename.toLowerCase());
			const domain = domainFromWebsite(fm?.['website']);
			if (domain) index.orgByDomain.set(domain, file.basename);
		}
	}
	return index;
}

async function loadDirectory(app: App, path: string): Promise<Map<string, DirectoryPerson> | null> {
	const file = app.vault.getAbstractFileByPath(normalizePath(path));
	if (!(file instanceof TFile)) return null;
	try {
		const dir = parseDirectory(await app.vault.read(file));
		return dir.size > 0 ? dir : null;
	} catch (e) {
		console.error('Fathom Sync: could not read directory CSV', e);
		return null;
	}
}

/** Meeting notes in `folder` that carry `attendees` frontmatter. */
export function readMeetingNotes(app: App, folder: string): MeetingInput[] {
	const out: MeetingInput[] = [];
	for (const file of filesUnder(app, folder)) {
		const raw: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.['attendees'];
		if (!Array.isArray(raw) || raw.length === 0) continue;
		const attendees = raw
			.filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
			.map(a => ({ name: typeof a['name'] === 'string' ? a['name'] : '', email: typeof a['email'] === 'string' ? a['email'] : '' }));
		out.push({ path: file.path, attendees });
	}
	return out;
}

export class AttendeeLinker {
	constructor(private app: App, private settings: () => LinkerSettings) {}

	private now(): string {
		return moment().format('YYYY-MM-DD HH:mm');
	}

	private async ensureFolder(path: string): Promise<void> {
		const p = normalizePath(path);
		if (this.app.vault.getAbstractFileByPath(p) instanceof TFolder) return;
		await this.app.vault.createFolder(p);
	}

	private contactFor(basename: string, email: string, firstName: string, lastName: string,
		person: DirectoryPerson | null, org: string | null, index: ContactIndex): NewContact {
		const s = this.settings();
		const organization = person ? s.directoryOrg : org ?? '';
		const date = moment().format('YYYY-MM-DD');
		return {
			firstName,
			lastName,
			email,
			title: person?.jobTitle ?? '',
			department: person?.department ?? '',
			phone: person?.phone ?? '',
			organization,
			orgHasRecord: organization !== '' && index.orgNames.has(organization.toLowerCase()),
			status: person?.terminated ? 'inactive' : 'active',
			vault: this.app.vault.getName(),
			date,
			provenance: person
				? `Created from faculty-staff directory by fathom-sync (${date})`
				: `Created from meeting attendees by fathom-sync (${date})`,
		};
	}

	/** Create a contact note; returns false (and records a failure) if the file already exists. */
	private async createContact(contact: NewContact, basename: string, record: RunRecord,
		source: 'directory' | 'attendee'): Promise<boolean> {
		const path = normalizePath(`${this.settings().contactsFolder}/${basename}.md`);
		if (this.app.vault.getAbstractFileByPath(path)) {
			record.failed.push({ path, error: 'contact file already exists; not overwritten' });
			return false;
		}
		try {
			await this.ensureFolder(this.settings().contactsFolder);
			await this.app.vault.create(path, renderContact(contact));
			record.created.push({ basename, source });
			return true;
		} catch (e) {
			record.failed.push({ path, error: e instanceof Error ? e.message : String(e) });
			return false;
		}
	}

	/** Insert Related lines; in preview mode compute them without writing. */
	private async applyLinks(links: Map<string, string[]>, record: RunRecord, write: boolean): Promise<void> {
		for (const [path, names] of links) {
			if (names.length === 0) continue;
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) {
				record.failed.push({ path, error: 'note not found' });
				continue;
			}
			try {
				let added: string[] = [];
				let hasFrontmatter = true;
				if (write) {
					await this.app.vault.process(file, content => {
						const r = insertRelatedLines(content, names);
						added = r.added;
						hasFrontmatter = r.hasFrontmatter;
						return r.content;
					});
				} else {
					const r = insertRelatedLines(await this.app.vault.read(file), names);
					added = r.added;
					hasFrontmatter = r.hasFrontmatter;
				}
				if (!hasFrontmatter) record.failed.push({ path, error: 'no frontmatter' });
				else if (added.length) record.changed.push({ path, added });
			} catch (e) {
				record.failed.push({ path, error: e instanceof Error ? e.message : String(e) });
			}
		}
	}

	private async writePreview(record: RunRecord): Promise<void> {
		const folder = this.settings().reportFolder;
		await this.ensureFolder(folder);
		const path = normalizePath(`${folder}/${PREVIEW_FILE}`);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) await this.app.vault.modify(existing, renderPreview(record));
		else await this.app.vault.create(path, renderPreview(record));
	}

	private async appendLog(record: RunRecord): Promise<void> {
		const folder = this.settings().reportFolder;
		await this.ensureFolder(folder);
		const path = normalizePath(`${folder}/${LOG_FILE}`);
		const section = renderLogSection(record);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) await this.app.vault.process(existing, c => `${c.trimEnd()}\n\n${section}`);
		else await this.app.vault.create(path, `# Attendee link log\n\n${section}`);
	}

	async run(meetings: MeetingInput[], mode: 'preview' | 'apply', title: string): Promise<RunResult> {
		const s = this.settings();
		const index = buildIndex(this.app, s.contactsFolder);
		const directory = await loadDirectory(this.app, s.directoryCsvPath);
		const p = plan(meetings, index, directory, {
			selfEmails: s.selfEmails,
			ignoredEmails: s.ignoredEmails,
			directoryOrg: s.directoryOrg,
		});
		const record = emptyRecord(mode === 'preview' ? 'preview' : title, this.now(), directory !== null);
		record.queued = p.queue;

		if (mode === 'preview') {
			record.created = p.creates.map(c => ({ basename: c.basename, source: 'directory' as const }));
			await this.applyLinks(p.links, record, false);
			await this.writePreview(record);
			return { record, plan: p };
		}

		for (const c of p.creates) {
			const contact = this.contactFor(c.basename, c.email, c.person.firstName, c.person.lastName, c.person, null, index);
			const ok = await this.createContact(contact, c.basename, record, 'directory');
			if (!ok) {
				// Never link a name whose file we didn't create: it may be someone else.
				for (const names of p.links.values()) {
					const i = names.indexOf(c.basename);
					if (i !== -1) names.splice(i, 1);
				}
			}
		}
		await this.applyLinks(p.links, record, true);
		await this.appendLog(record);
		return { record, plan: p };
	}

	async approve(selected: QueuedPerson[], unselected: QueuedPerson[]): Promise<RunRecord> {
		const index = buildIndex(this.app, this.settings().contactsFolder);
		const record = emptyRecord('review', this.now(), true);
		const links = new Map<string, string[]>();

		for (const q of selected) {
			if (q.kind !== 'external') continue;
			const contact = this.contactFor(q.basename, q.email, q.firstName, q.lastName, q.person, q.org, index);
			if (!(await this.createContact(contact, q.basename, record, 'attendee'))) continue;
			for (const path of q.meetings) {
				const list = links.get(path) ?? [];
				if (!list.includes(q.basename)) list.push(q.basename);
				links.set(path, list);
			}
		}
		record.ignored = unselected.filter(q => q.kind === 'external').map(q => q.email);

		await this.applyLinks(links, record, true);
		await this.appendLog(record);
		return record;
	}
}
```

- [ ] **Step 2: Write `ReviewModal.ts`**

`src/attendees/ReviewModal.ts`:

```ts
import { App, Modal, Setting } from 'obsidian';
import type { QueuedPerson } from './planner';

export class ReviewModal extends Modal {
	private checked = new Set<string>();

	constructor(
		app: App,
		private queue: QueuedPerson[],
		private onSubmit: (selected: QueuedPerson[], unselected: QueuedPerson[]) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Fathom Sync: review attendees' });

		const collisions = this.queue.filter(q => q.kind === 'collision');
		const externals = this.queue.filter(q => q.kind === 'external');

		if (collisions.length) {
			contentEl.createEl('h3', { text: `Name collisions (${collisions.length})` });
			contentEl.createEl('p', {
				text: 'A contact file with this name already exists. Resolve by hand, for example by adding the email to the existing record. These will be listed again next run.',
			});
			const ul = contentEl.createEl('ul');
			for (const q of collisions) {
				ul.createEl('li', {
					text: `${q.basename} <${q.email}>${q.existingPath ? ` · existing: ${q.existingPath}` : ' · name used twice in this run'}`,
				});
			}
		}

		if (externals.length) {
			contentEl.createEl('h3', { text: `Externals (${externals.length})` });
			contentEl.createEl('p', {
				text: 'Checked people become contacts. "Create selected" leaves everyone else to be asked again next backfill; "Create selected, ignore the rest" adds the unchecked people to the ignore list.',
			});
			for (const q of externals) {
				const meetings = `${q.meetings.length} meeting${q.meetings.length === 1 ? '' : 's'}`;
				new Setting(contentEl)
					.setName(`${q.basename}`)
					.setDesc(`${q.email} · ${q.org ?? q.domain} · ${meetings}`)
					.addToggle(t =>
						t.setValue(false).onChange(v => {
							if (v) this.checked.add(q.email);
							else this.checked.delete(q.email);
						}),
					);
			}
		}

		const buttons = new Setting(contentEl);
		if (externals.length) {
			const submit = async (ignoreRest: boolean) => {
				const selected = externals.filter(q => this.checked.has(q.email));
				const unselected = ignoreRest ? externals.filter(q => !this.checked.has(q.email)) : [];
				this.close();
				await this.onSubmit(selected, unselected);
			};
			buttons.addButton(b => b.setButtonText('Create selected').setCta().onClick(() => submit(false)));
			// Ignoring is permanent and can cover hundreds of people on a first backfill,
			// so it takes a second click that states the count.
			// onClick() adds a listener rather than replacing one, so confirm with a flag.
			let confirming = false;
			buttons.addButton(b =>
				b
					.setButtonText('Create selected, ignore the rest')
					.setWarning()
					.onClick(async () => {
						const rest = externals.length - this.checked.size;
						if (rest > 0 && !confirming) {
							confirming = true;
							b.setButtonText(`Click again to ignore ${rest} ${rest === 1 ? 'person' : 'people'}`);
							return;
						}
						await submit(true);
					}),
			);
		}
		buttons.addButton(b => b.setButtonText('Close without choosing').onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
```

- [ ] **Step 3: Type-check and build**

Run: `npm run build`
Expected: exits 0, no TypeScript errors. The new files aren't imported yet, so `tsc` checks them through `include: ["src/**/*.ts"]` while esbuild doesn't bundle them yet.

- [ ] **Step 4: Run the suite (nothing broke)**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/attendees/linker.ts src/attendees/ReviewModal.ts
git commit -m "feat(attendees): Obsidian linker, preview/log writer and review modal"
```

---

### Task 8: Wire it into `main.ts`

**Files:**
- Modify: `src/main.ts` (imports at line 1; `FathomSyncSettings` and `DEFAULT_SETTINGS` around lines 88–108; `onload` around 120; `loadSettings`; `syncNewMeetings`, `syncAllMeetings`, `processMeetings`, `createOrUpdateMeetingNote`; `FathomSyncSettingTab.display`)

**Interfaces:**
- Consumes: `AttendeeLinker`, `readMeetingNotes`, `LinkerSettings`, `RunResult` (Task 7); `ReviewModal` (Task 7); `MeetingInput` (Task 5); `summaryLine`, `RunRecord` (Task 6)

- [ ] **Step 1: Add the imports**

At the top of `src/main.ts`, after the `obsidian` import:

```ts
import { AttendeeLinker, readMeetingNotes, type RunResult } from './attendees/linker';
import type { MeetingInput } from './attendees/planner';
import { summaryLine } from './attendees/report';
import { ReviewModal } from './attendees/ReviewModal';
```

- [ ] **Step 2: Extend the settings**

Replace the `FathomSyncSettings` interface and `DEFAULT_SETTINGS` with:

```ts
interface FathomSyncSettings {
	apiKey: string;
	meetingFolder: string;
	includeTranscript: boolean;
	includeSummary: boolean;
	includeActionItems: boolean;
	fileNameFormat: string;
	syncOnStartup: boolean;
	lastSyncedAt: string | null;
	linkOnSync: boolean;
	contactsFolder: string;
	directoryCsvPath: string;
	directoryOrg: string;
	selfEmails: string[];
	ignoredEmails: string[];
	reportFolder: string;
}

const DEFAULT_SETTINGS: FathomSyncSettings = {
	apiKey: '',
	meetingFolder: 'Meetings/Fathom',
	includeTranscript: true,
	includeSummary: true,
	includeActionItems: true,
	fileNameFormat: '{{date}} — {{title}}',
	syncOnStartup: false,
	lastSyncedAt: null,
	linkOnSync: true,
	contactsFolder: '30-REFERENCE/Contacts',
	directoryCsvPath: '70-PROJECTS/Maryville Institutional AI/faculty-staff/faculty-staff.csv',
	directoryOrg: 'Maryville University',
	selfEmails: [],
	ignoredEmails: [],
	reportFolder: '90-SYSTEM/fathom-sync',
};
```

Replace `loadSettings` so the default arrays are never shared by reference:

```ts
async loadSettings() {
	this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	this.settings.selfEmails = [...(this.settings.selfEmails ?? [])];
	this.settings.ignoredEmails = [...(this.settings.ignoredEmails ?? [])];
}
```

- [ ] **Step 3: Create the linker and register the commands in `onload`**

Add a field to the class, under `settings: FathomSyncSettings;`:

```ts
linker: AttendeeLinker;
```

In `onload`, right after `await this.loadSettings();`:

```ts
this.linker = new AttendeeLinker(this.app, () => this.settings);
```

After the existing `sync-all-meetings` command:

```ts
this.addCommand({
	id: 'preview-attendee-links',
	name: 'Preview attendee linking for all meeting notes',
	callback: () => this.backfillAttendees('preview'),
});

this.addCommand({
	id: 'link-attendees',
	name: 'Link attendees in all meeting notes',
	callback: () => this.backfillAttendees('apply'),
});
```

- [ ] **Step 4: Collect created notes during sync**

Change `createOrUpdateMeetingNote` to return the created note's input (or `null` when it already existed). Replace its signature and the two `return` statements:

```ts
private async createOrUpdateMeetingNote(meeting: FathomMeeting): Promise<MeetingInput | null> {
	const filename = this.buildFilename(meeting);
	const filePath = `${this.settings.meetingFolder}/${filename}.md`;

	// Skip if file already exists
	const existing = this.app.vault.getAbstractFileByPath(filePath);
	if (existing) return null;
```

…and at the end, replacing `return true;`:

```ts
	await this.app.vault.create(filePath, content);
	return {
		path: filePath,
		attendees: (meeting.calendar_invitees ?? []).map(inv => ({ name: inv.name ?? '', email: inv.email ?? '' })),
		recordedByEmail: meeting.recorded_by?.email,
	};
}
```

Change `processMeetings` to return the created inputs:

```ts
private async processMeetings(meetings: FathomMeeting[]): Promise<{ created: number; existed: number; skipped: number; notes: MeetingInput[] }> {
	await this.ensureFolder(this.settings.meetingFolder);

	let created = 0;
	let existed = 0;
	let skipped = 0;
	const notes: MeetingInput[] = [];

	for (let idx = 0; idx < meetings.length; idx++) {
		const meeting = meetings[idx]!;
		try {
			const note = await this.createOrUpdateMeetingNote(meeting);
			if (note) {
				created++;
				notes.push(note);
				// Throttle between new notes to avoid rate limits
				// Each new note makes up to 2 API calls (summary + transcript),
				// so space them out more generously
				if (idx < meetings.length - 1) await this.delay(1500);
			} else {
				existed++;
			}
		} catch (e) {
			if (e instanceof FathomLockedError) {
				skipped++;
				console.log(`Fathom Sync: Skipping "${meeting.title}" — still processing`);
			} else {
				throw e;
			}
		}
	}

	return { created, existed, skipped, notes };
}
```

- [ ] **Step 5: Link after sync, and add the backfill and review handlers**

In both `syncNewMeetings` and `syncAllMeetings`, change the destructuring line to

```ts
const { created, skipped, notes } = await this.processMeetings(meetings);
```

and add, immediately after the existing final `new Notice(\`Fathom Sync: ${meetings.length} found, …\`)` line inside the `try`:

```ts
await this.linkSyncedNotes(notes);
```

Add these methods to the class, after `syncAllMeetings`:

```ts
// ─── Attendee linking ────────────────────────────────────────────────

private async linkSyncedNotes(notes: MeetingInput[]) {
	if (!this.settings.linkOnSync || notes.length === 0) return;
	try {
		const result = await this.linker.run(notes, 'apply', 'sync');
		this.reportAndReview(result);
	} catch (e) {
		// Linking is an add-on: it must never fail the sync.
		console.error('Fathom Sync: attendee linking failed', e);
		new Notice('Fathom Sync: attendee linking failed. See the console.');
	}
}

private async backfillAttendees(mode: 'preview' | 'apply') {
	if (this.settings.selfEmails.length === 0) {
		new Notice('Fathom Sync: set "Your emails" in settings before linking attendees.');
		return;
	}
	const meetings = readMeetingNotes(this.app, this.settings.meetingFolder);
	new Notice(`Fathom Sync: ${mode === 'preview' ? 'previewing' : 'linking'} attendees in ${meetings.length} meeting notes...`);
	try {
		const result = await this.linker.run(meetings, mode, 'backfill');
		if (mode === 'preview') {
			new Notice(`Fathom Sync preview: ${summaryLine(result.record)}. See ${this.settings.reportFolder}/attendee-link-preview.md`);
			return;
		}
		this.reportAndReview(result);
	} catch (e) {
		console.error('Fathom Sync: attendee backfill failed', e);
		new Notice(`Fathom Sync: attendee linking failed — ${e instanceof Error ? e.message : String(e)}`);
	}
}

private reportAndReview(result: RunResult) {
	new Notice(`Fathom Sync: ${summaryLine(result.record)}`);
	if (result.plan.queue.length === 0) return;
	new ReviewModal(this.app, result.plan.queue, async (selected, unselected) => {
		try {
			const record = await this.linker.approve(selected, unselected);
			for (const email of record.ignored) {
				if (!this.settings.ignoredEmails.includes(email)) this.settings.ignoredEmails.push(email);
			}
			await this.saveSettings();
			new Notice(`Fathom Sync: ${summaryLine(record)}`);
		} catch (e) {
			console.error('Fathom Sync: review failed', e);
			new Notice('Fathom Sync: creating reviewed contacts failed. See the console.');
		}
	}).open();
}
```

- [ ] **Step 6: Add the settings tab section**

At the end of `FathomSyncSettingTab.display()`, after the "Sync on startup" setting:

```ts
containerEl.createEl('h3', { text: 'Attendee linking' });

new Setting(containerEl)
	.setName('Link attendees on sync')
	.setDesc('After each sync, add Related: [[Name]] lines for attendees with a Contact record.')
	.addToggle(t =>
		t.setValue(this.plugin.settings.linkOnSync).onChange(async v => {
			this.plugin.settings.linkOnSync = v;
			await this.plugin.saveSettings();
		}),
	);

const textSetting = (name: string, desc: string, key: 'contactsFolder' | 'directoryCsvPath' | 'directoryOrg' | 'reportFolder') =>
	new Setting(containerEl)
		.setName(name)
		.setDesc(desc)
		.addText(t =>
			t.setValue(this.plugin.settings[key]).onChange(async v => {
				this.plugin.settings[key] = key === 'directoryOrg' ? v.trim() : v.trim().replace(/^\/|\/$/g, '');
				await this.plugin.saveSettings();
			}),
		);

textSetting('Contacts folder', 'Folder holding person and organization records.', 'contactsFolder');
textSetting('Directory CSV path', 'Faculty-staff directory export used to create Maryville contacts.', 'directoryCsvPath');
textSetting('Directory organization', 'Organization written on contacts created from the directory.', 'directoryOrg');
textSetting('Report folder', 'Where the preview and the run log are written.', 'reportFolder');

const listSetting = (name: string, desc: string, key: 'selfEmails' | 'ignoredEmails') =>
	new Setting(containerEl)
		.setName(name)
		.setDesc(desc)
		.addTextArea(t =>
			t.setValue(this.plugin.settings[key].join('\n')).onChange(async v => {
				this.plugin.settings[key] = v.split('\n').map(s => s.trim()).filter(Boolean);
				await this.plugin.saveSettings();
			}),
		);

listSetting('Your emails', 'One per line. Never linked. Required before Preview or Link attendees will run.', 'selfEmails');
listSetting('Ignored emails', 'One per line. Filled in by the review modal; delete a line to be asked about that person again.', 'ignoredEmails');
```

- [ ] **Step 7: Build and test**

Run: `npm run build && npm test`
Expected: build exits 0, all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main.ts main.js
git commit -m "feat: link attendees after sync and add backfill commands"
```

---

### Task 9: Release, install and acceptance on the real vault

**Files:**
- Modify: `manifest.json` (version → 1.5.0, `minAppVersion` → 1.1.0), `package.json` (version → 1.5.0)
- Modify: `README.md`

- [ ] **Step 1: Bump the version and rebuild**

Set `"version": "1.5.0"` in both `manifest.json` and `package.json`, and `"minAppVersion": "1.1.0"` in `manifest.json` (`vault.process` arrived in 1.1.0). Then run:

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 2: Document the feature in the README**

Add this section after `## Usage` → `### Commands`, and add the two commands to the commands table:

```markdown
### Attendee linking

After each sync, fathom-sync links meeting attendees to Contact records by email, adding one `Related: [[Name]]` line per person under the note's frontmatter.

- **Existing contact** with that email → linked.
- **In the faculty-staff directory CSV** → a contact is created from the directory row, then linked.
- **Anyone else** → listed in a review modal at the end of the run. Checked people become contacts. **Create selected** leaves the rest to be asked about again; **Create selected, ignore the rest** (confirmed with a second click) adds them to the ignore list.
- **Name collision** (a contact file with that name already exists under another email) → listed in the modal, never created; resolve by hand.

Commands:

| Command | Description |
|---------|-------------|
| **Fathom Sync: Preview attendee linking for all meeting notes** | Writes `90-SYSTEM/fathom-sync/attendee-link-preview.md`; changes nothing else |
| **Fathom Sync: Link attendees in all meeting notes** | Backfills every existing meeting note |

Every real run appends what it changed to `90-SYSTEM/fathom-sync/attendee-link-log.md`. All writes only insert lines, so a run can be reversed from the log. Set **Your emails** in settings first; the backfill commands refuse to run without it.
```

- [ ] **Step 3: Commit**

```bash
git add manifest.json package.json package-lock.json main.js README.md
git commit -m "chore: release 1.5.0 — attendee contact linking"
```

- [ ] **Step 4: Install into the vault (keeping a backup)**

```bash
P="/Users/merkel/Library/CloudStorage/SynologyDrive-obsidian/cursus-opus/.obsidian/plugins/fathom-sync"
cp "$P/main.js" "$P/main.js.bak-1.4.0"
cp main.js manifest.json "$P/"
```

Then in Obsidian: **Settings → Community plugins**, toggle Fathom Sync off and on (or reload the app).

- [ ] **Step 5: Configure**

Settings → Fathom Sync → Attendee linking: set **Your emails** to `bmerkel@maryville.edu`. Confirm the folder and CSV defaults match the vault.

- [ ] **Step 6: Preview (human gate)**

Run **Fathom Sync: Preview attendee linking for all meeting notes**. Open `90-SYSTEM/fathom-sync/attendee-link-preview.md` and check:

- The summary counts look plausible: roughly 500+ notes to change and dozens of contacts to create.
- About 10 entries under **Notes changed**: each listed name really attended that meeting (compare against the note's `attendees`).
- About 5 entries under **Contacts created**: each is a real Maryville person, named correctly.
- **To review** contains externals and any name collisions, and no Maryville staff unless they're collisions or missing from the CSV.
- **Failed** is empty or explainable.

Stop here and fix anything wrong before Step 7. Nothing has been written yet.

- [ ] **Step 7: Apply the backfill**

Run **Fathom Sync: Link attendees in all meeting notes**. In the review modal, check the externals worth a contact record, then click **Create selected, ignore the rest** and confirm with the second click.

Verify:

- About 10 changed notes show the new `Related:` lines directly under the frontmatter, with existing lines untouched.
- About 5 created contacts open correctly, show `vault: cursus-opus`, and their **Meetings** dataview lists the meetings.
- `90-SYSTEM/fathom-sync/attendee-link-log.md` has a `backfill` section and a `review` section.
- Settings → Ignored emails holds the externals you left unchecked, and nobody you checked.

- [ ] **Step 8: Idempotence check**

Run **Link attendees in all meeting notes** again.
Expected Notice: `Linked 0 notes · created 0 contacts · N to review · 0 failed`, where N counts only name collisions (they reappear by design), and the modal lists only those.

- [ ] **Step 9: Sync check**

Run **Fathom Sync: Sync new meetings**. If a new meeting arrives, its note gets `Related:` lines at creation and the summary Notice appears. If none arrive, nothing about linking appears.

---

## Applied Lessons

Grepped `mnemosyne/50-DEVELOPMENT/_shared/lessons-learned.md` for this plan's mechanisms (CSV parsing, email normalisation, idempotent re-runs, backfill, bulk note edits, frontmatter). There is no project `system-patterns.md` (fathom-sync has no pf META docs).

| Entry | Disposition |
|---|---|
| L31 (NBSP, zero-width, BOM, emails normalised on both paths, typed DTO at CSV edges) | Applied: Task 1's `normalizeEmail` strips invisible characters that `trim()` leaves, and is used on every compare path (contact index, directory, attendees, self and ignore lists). Task 2 maps rows into a typed `DirectoryPerson` once. |
| L35 (idempotency keys on the artifact the operation produces) | Applied: Task 3 keys "already done" on the `Related: [[Name]]` line itself, not on "this note was processed", so a partial run is completed by the next run. Task 9 Step 8 verifies a second run is a no-op. |
| L2 (assert parsed effects, not declarations) | Applied: Tasks 2 and 6 assert parsed CSV values and rendered text, not configuration. |
| L30 (backfill before type conversion) | N/A: database migrations; this backfill only inserts lines into notes. |

No shared-lessons entry names an arch test applicable to an Obsidian plugin.
