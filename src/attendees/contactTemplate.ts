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
		`email: '${c.email.replace(/'/g, "''")}'`,
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
	if (orgRef) lines.push(`| ${orgRef} | ${c.title} | | | ${c.status} |`);
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
