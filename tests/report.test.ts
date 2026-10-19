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

describe('collision lines', () => {
	it('shows the email and "no usable name" when the basename is empty', () => {
		const r = emptyRecord('sync', 'x', true);
		r.queued.push({ ...queued, kind: 'collision', basename: '', email: 'ghost@vendor.com', org: null, meetings: ['m/a.md'] });
		const out = renderLogSection(r);
		expect(out).toContain('- <ghost@vendor.com> · 1 meeting · no usable name');
		expect(out).not.toContain('in this run');
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
