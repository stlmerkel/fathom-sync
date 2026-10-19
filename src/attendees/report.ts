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
