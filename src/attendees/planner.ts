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
