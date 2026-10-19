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
