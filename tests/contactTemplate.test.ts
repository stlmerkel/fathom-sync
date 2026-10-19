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

	it('uses the contact status in the frontmatter and the affiliation row', () => {
		const o = renderContact({ ...BASE, status: 'inactive' });
		expect(o).toContain('status: inactive');
		expect(o).toContain('| [[Maryville University]] | Senior Associate: CTL | | | inactive |');
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

	it('escapes an apostrophe in the email so the YAML stays valid', () => {
		const o = renderContact({ ...BASE, email: "o'brien@maryville.edu" });
		expect(o).toMatch(/^email: 'o''brien@maryville.edu'$/m);
	});
});
