import { App, TFile, TFolder, moment, normalizePath } from 'obsidian';
import { renderContact, type NewContact } from './contactTemplate';
import { parseDirectory, type DirectoryPerson } from './directory';
import { domainFromWebsite, emailsOf } from './normalize';
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
// Written line by line during a writing run and removed when it finishes, so an interrupted
// run still leaves a record of what it changed (folded into the log by the next run).
const JOURNAL_FILE = 'attendee-link-journal.md';

function filesUnder(app: App, folder: string): TFile[] {
	const prefix = normalizePath(folder) + '/';
	return app.vault.getMarkdownFiles().filter(f => f.path.startsWith(prefix));
}

function buildIndex(app: App, contactsFolder: string): ContactIndex {
	const index: ContactIndex = { byEmail: new Map(), byName: new Map(), orgByDomain: new Map(), orgNames: new Set() };
	for (const file of filesUnder(app, contactsFolder)) {
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		const docType: unknown = fm?.['document_type'];
		const type = typeof docType === 'string' ? docType.trim().toLowerCase() : '';
		// A contact can carry several addresses: `email` and `secondary_email`, each a string or a list.
		const emails = type === 'contact' ? [...emailsOf(fm?.['email']), ...emailsOf(fm?.['secondary_email'])] : [];
		// Every file in the folder holds its name, whatever its frontmatter says (or if the cache isn't ready).
		index.byName.set(file.basename.toLowerCase(), { basename: file.basename, path: file.path, email: emails[0] ?? '' });
		for (const email of emails) index.byEmail.set(email, file.basename);
		if (type === 'organization') {
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

	/** True if a file exists at `path`, compared case-insensitively (macOS filesystems are). */
	private pathTaken(path: string): boolean {
		if (this.app.vault.getAbstractFileByPath(path)) return true;
		const lower = path.toLowerCase();
		return filesUnder(this.app, this.settings().contactsFolder).some(f => f.path.toLowerCase() === lower);
	}

	/** Create a contact note; returns false (and records a failure) if the file already exists. */
	private async createContact(contact: NewContact, basename: string, record: RunRecord,
		source: 'directory' | 'attendee'): Promise<boolean> {
		const path = normalizePath(`${this.settings().contactsFolder}/${basename}.md`);
		if (this.pathTaken(path)) {
			record.failed.push({ path, error: 'contact file already exists; not overwritten' });
			return false;
		}
		try {
			await this.ensureFolder(this.settings().contactsFolder);
			await this.app.vault.create(path, renderContact(contact));
			record.created.push({ basename, source });
			await this.journal(`- [[${basename}]] (${source})`);
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
				else if (added.length) {
					record.changed.push({ path, added });
					if (write) await this.journal([`- \`${path}\``, ...added.map(n => `  - \`Related: [[${n}]]\``)].join('\n'));
				}
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
		await this.appendLogText(renderLogSection(record));
	}

	private async appendLogText(section: string): Promise<void> {
		const folder = this.settings().reportFolder;
		await this.ensureFolder(folder);
		const path = normalizePath(`${folder}/${LOG_FILE}`);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) await this.app.vault.process(existing, c => `${c.replace(/\s+$/, '')}\n\n${section}`);
		else await this.app.vault.create(path, `# Attendee link log\n\n${section}`);
	}

	private journalPath(): string {
		return normalizePath(`${this.settings().reportFolder}/${JOURNAL_FILE}`);
	}

	/** Start a writing run's journal, first moving any journal an interrupted run left into the log. */
	private async startJournal(record: RunRecord): Promise<void> {
		const adapter = this.app.vault.adapter;
		const path = this.journalPath();
		try {
			await this.ensureFolder(this.settings().reportFolder);
			if (await adapter.exists(path)) {
				const left = (await adapter.read(path)).trim();
				if (left) await this.appendLogText(`## ${this.now()} — interrupted run, recovered from the journal\n\n${left}\n`);
			}
			await adapter.write(path, `Run ${record.title} started ${record.when}. Each change is listed as it is written.\n\n`);
		} catch (e) {
			console.error('Fathom Sync: could not start the attendee link journal', e);
		}
	}

	private async journal(entry: string): Promise<void> {
		try {
			await this.app.vault.adapter.append(this.journalPath(), `${entry}\n`);
		} catch (e) {
			console.error('Fathom Sync: could not write the attendee link journal', e, entry);
		}
	}

	private async endJournal(): Promise<void> {
		try {
			await this.app.vault.adapter.remove(this.journalPath());
		} catch (e) {
			console.error('Fathom Sync: could not remove the attendee link journal', e);
		}
	}

	/** Write the log; on failure keep the change list recoverable from the console and never throw. */
	private async safeAppendLog(record: RunRecord): Promise<boolean> {
		try {
			await this.appendLog(record);
			return true;
		} catch (e) {
			const path = normalizePath(`${this.settings().reportFolder}/${LOG_FILE}`);
			console.error('Fathom Sync: could not write the attendee link log', e);
			console.error(renderLogSection(record));
			record.failed.push({ path, error: e instanceof Error ? e.message : String(e) });
			return false;
		}
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
			for (const c of p.creates) {
				const path = normalizePath(`${s.contactsFolder}/${c.basename}.md`);
				if (this.pathTaken(path)) record.failed.push({ path, error: 'contact file already exists; not overwritten' });
				else record.created.push({ basename: c.basename, source: 'directory' });
			}
			await this.applyLinks(p.links, record, false);
			await this.writePreview(record);
			return { record, plan: p };
		}

		await this.startJournal(record);
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
		// Keep the journal if the log could not be written: the next run recovers it.
		if (await this.safeAppendLog(record)) await this.endJournal();
		return { record, plan: p };
	}

	async approve(selected: QueuedPerson[], unselected: QueuedPerson[]): Promise<RunRecord> {
		const index = buildIndex(this.app, this.settings().contactsFolder);
		const record = emptyRecord('review', this.now(), true);
		const links = new Map<string, string[]>();
		await this.startJournal(record);

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
		if (await this.safeAppendLog(record)) await this.endJournal();
		return record;
	}
}
