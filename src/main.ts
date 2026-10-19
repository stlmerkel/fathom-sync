import { App, Notice, Plugin, PluginSettingTab, TFolder, moment, requestUrl, type SettingDefinitionItem } from 'obsidian';
import { AttendeeLinker, readMeetingNotes, type RunResult } from './attendees/linker';
import type { MeetingInput } from './attendees/planner';
import { summaryLine } from './attendees/report';
import { ReviewModal } from './attendees/ReviewModal';

// ─── Types ──────────────────────────────────────────────────────────────────

interface FathomMeeting {
	title: string;
	meeting_title: string;
	recording_id: number;
	url: string;
	share_url: string;
	created_at: string;
	scheduled_start_time: string;
	scheduled_end_time: string;
	recording_start_time: string;
	recording_end_time: string;
	calendar_invitees_domains_type: string;
	transcript_language: string;
	transcript: FathomTranscriptItemInline[] | null;
	default_summary: { template_name: string; markdown_formatted: string } | null;
	action_items: FathomActionItem[] | null;
	calendar_invitees: FathomInvitee[];
	recorded_by: {
		name: string;
		email: string;
		email_domain: string;
		team: string;
	};
}

interface FathomTranscriptItemInline {
	speaker: string;
	text: string;
	timestamp: string;
}

interface FathomTranscriptItem {
	speaker: {
		display_name: string;
		matched_calendar_invitee_email: string | null;
	};
	text: string;
	timestamp: string;
}

interface FathomAssignee {
	name: string | null;
	email: string | null;
	team: string | null;
}

interface FathomActionItem {
	description: string;
	user_generated: boolean;
	completed: boolean;
	recording_timestamp: string;
	recording_playback_url: string;
	assignee: FathomAssignee | null;
}

interface FathomInvitee {
	name: string;
	email: string;
	email_domain: string;
	is_external: boolean;
}

interface FathomListResponse {
	limit: number | null;
	next_cursor: string | null;
	items: FathomMeeting[];
}

interface FathomSummaryResponse {
	summary: {
		template_name: string | null;
		markdown_formatted: string | null;
	};
}

interface FathomTranscriptResponse {
	transcript: FathomTranscriptItem[];
}

// ─── Settings ───────────────────────────────────────────────────────────────

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

const BASE_URL = 'https://api.fathom.ai/external/v1';

class FathomLockedError extends Error {
	constructor(path: string) {
		super(`Recording still processing (${path})`);
		this.name = 'FathomLockedError';
	}
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

export default class FathomSyncPlugin extends Plugin {
	settings: FathomSyncSettings;
	linker: AttendeeLinker;

	async onload() {
		await this.loadSettings();
		this.linker = new AttendeeLinker(this.app, () => this.settings);
		this.addSettingTab(new FathomSyncSettingTab(this.app, this));

		this.addRibbonIcon('video', 'Sync Fathom meetings', () => {
			this.syncNewMeetings();
		});

		this.addCommand({
			id: 'sync-new-meetings',
			name: 'Sync new meetings',
			callback: () => this.syncNewMeetings(),
		});

		this.addCommand({
			id: 'sync-all-meetings',
			name: 'Sync all meetings (full re-sync)',
			callback: () => this.syncAllMeetings(),
		});

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

		if (this.settings.syncOnStartup && this.settings.apiKey) {
			// Delay to let vault fully load
			this.registerInterval(
				window.setTimeout(() => this.syncNewMeetings(), 5000) as unknown as number
			);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.settings.selfEmails = [...(this.settings.selfEmails ?? [])];
		this.settings.ignoredEmails = [...(this.settings.ignoredEmails ?? [])];
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// ─── API helpers ──────────────────────────────────────────────────────

	private async apiGet<T>(path: string, params?: Record<string, string>): Promise<T> {
		const url = new URL(`${BASE_URL}${path}`);
		if (params) {
			for (const [k, v] of Object.entries(params)) {
				url.searchParams.append(k, v);
			}
		}

		const maxRetries = 5;
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			let resp;
			try {
				resp = await requestUrl({
					url: url.toString(),
					headers: { 'X-Api-Key': this.settings.apiKey },
					throw: false,
				});
			} catch (e: unknown) {
				// requestUrl throws on network errors and non-2xx without throw:false
				// Extract status from the error if possible
				const status = (e as { status?: number })?.status;
				if (status === 429) {
					if (attempt < maxRetries) {
						const wait = Math.pow(2, attempt + 1) * 1000;
						console.log(`Fathom Sync: Rate limited on ${path}, waiting ${wait / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
						await this.delay(wait);
						continue;
					}
					throw new Error(`Fathom API rate limited on ${path} after ${maxRetries} retries`);
				}
				if (status === 423) {
					throw new FathomLockedError(path);
				}
				throw e;
			}

			if (resp.status === 429) {
				if (attempt < maxRetries) {
					const wait = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s, 16s, 32s
					console.log(`Fathom Sync: Rate limited on ${path}, waiting ${wait / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
					await this.delay(wait);
					continue;
				}
				throw new Error(`Fathom API rate limited on ${path} after ${maxRetries} retries`);
			}

			if (resp.status === 423) {
				throw new FathomLockedError(path);
			}

			if (resp.status !== 200) {
				throw new Error(`Fathom API error ${resp.status} on ${path}: ${resp.text}`);
			}

			return resp.json as T;
		}

		// Unreachable, but TypeScript needs it
		throw new Error(`Fathom API: unexpected state on ${path}`);
	}

	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * Scan existing meeting notes to recover lastSyncedAt when data.json is lost
	 * (e.g. after reinstall or version upgrade). Reads the `date` frontmatter
	 * field from files in the meeting folder and returns the latest one as an
	 * ISO timestamp, or null if no notes exist.
	 */
	private recoverLastSyncDate(): string | null {
		const folder = this.app.vault.getAbstractFileByPath(this.settings.meetingFolder);
		if (!(folder instanceof TFolder)) return null;

		let latestDate: string | null = null;

		for (const file of folder.children) {
			if (file.name.endsWith('.md')) {
				const cache = this.app.metadataCache.getCache(file.path);
				const date = cache?.frontmatter?.['date'];
				if (date && typeof date === 'string') {
					// Frontmatter stores YYYY-MM-DD; compare lexicographically
					if (!latestDate || date > latestDate) {
						latestDate = date;
					}
				}
			}
		}

		if (!latestDate) return null;

		// Convert YYYY-MM-DD to an ISO timestamp at end of day so we don't
		// re-fetch meetings from that same day
		return moment(latestDate).endOf('day').toISOString();
	}

	private async fetchAllMeetings(createdAfter?: string): Promise<FathomMeeting[]> {
		const all: FathomMeeting[] = [];
		let cursor: string | undefined;

		do {
			const params: Record<string, string> = {
				include_action_items: 'true',
			};
			if (cursor) params['cursor'] = cursor;
			if (createdAfter) params['created_after'] = createdAfter;

			try {
				const resp = await this.apiGet<FathomListResponse>('/meetings', params);
				all.push(...resp.items);
				cursor = resp.next_cursor ?? undefined;
			} catch (e) {
				if (e instanceof FathomLockedError) {
					console.log('Fathom Sync: Meetings endpoint returned 423, retrying in 2s...');
					await new Promise(resolve => setTimeout(resolve, 2000));
					continue;
				}
				throw e;
			}
		} while (cursor);

		return all;
	}

	private async fetchSummary(recordingId: number): Promise<string | null> {
		try {
			const resp = await this.apiGet<FathomSummaryResponse>(
				`/recordings/${recordingId}/summary`
			);
			return resp.summary?.markdown_formatted ?? null;
		} catch {
			return null;
		}
	}

	private async fetchTranscript(recordingId: number): Promise<FathomTranscriptItem[] | null> {
		try {
			const resp = await this.apiGet<FathomTranscriptResponse>(
				`/recordings/${recordingId}/transcript`
			);
			return resp.transcript ?? null;
		} catch {
			return null;
		}
	}

	// ─── Sync logic ───────────────────────────────────────────────────────

	async syncNewMeetings() {
		if (!this.settings.apiKey) {
			new Notice('Fathom Sync: Please set your API key in settings.');
			return;
		}

		// If lastSyncedAt is missing, try to recover it from existing notes
		if (!this.settings.lastSyncedAt) {
			const recovered = this.recoverLastSyncDate();
			if (recovered) {
				this.settings.lastSyncedAt = recovered;
				await this.saveSettings();
				console.log(`Fathom Sync: Recovered lastSyncedAt from existing notes: ${recovered}`);
			}
		}

		const since = this.settings.lastSyncedAt;
		const label = since
			? `since ${moment(since).format('MMM D, h:mm A')}`
			: '(first sync)';
		new Notice(`Fathom Sync: Checking for new meetings ${label}...`);

		const notes: MeetingInput[] = [];
		try {
			const meetings = await this.fetchAllMeetings(since ?? undefined);
			const { created, skipped } = await this.processMeetings(meetings, notes);

			// Update lastSyncedAt to the most recent meeting's created_at
			if (meetings.length > 0) {
				const latest = meetings
					.map(m => m.created_at)
					.sort()
					.pop()!;
				this.settings.lastSyncedAt = latest;
				await this.saveSettings();
			}

			const parts = [`${created} new`];
			if (skipped > 0) parts.push(`${skipped} still processing`);
			new Notice(`Fathom Sync: ${meetings.length} found, ${parts.join(', ')}.`);
		} catch (e) {
			new Notice(`Fathom Sync: Error — ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			// Notes created before an error still need linking; later syncs would skip them as existing.
			await this.linkSyncedNotes(notes);
		}
	}

	async syncAllMeetings() {
		if (!this.settings.apiKey) {
			new Notice('Fathom Sync: Please set your API key in settings.');
			return;
		}
		new Notice('Fathom Sync: Full re-sync — fetching all meetings...');
		const notes: MeetingInput[] = [];
		try {
			const meetings = await this.fetchAllMeetings();
			const { created, skipped } = await this.processMeetings(meetings, notes);

			if (meetings.length > 0) {
				const latest = meetings
					.map(m => m.created_at)
					.sort()
					.pop()!;
				this.settings.lastSyncedAt = latest;
				await this.saveSettings();
			}

			const parts = [`${created} new`];
			if (skipped > 0) parts.push(`${skipped} still processing`);
			new Notice(`Fathom Sync: ${meetings.length} found, ${parts.join(', ')}.`);
		} catch (e) {
			new Notice(`Fathom Sync: Error — ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			// Notes created before an error still need linking; later syncs would skip them as existing.
			await this.linkSyncedNotes(notes);
		}
	}

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
			new Notice(`Fathom Sync: attendee linking failed \u2014 ${e instanceof Error ? e.message : String(e)}`);
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

	private async processMeetings(meetings: FathomMeeting[], notes: MeetingInput[]): Promise<{ created: number; existed: number; skipped: number }> {
		await this.ensureFolder(this.settings.meetingFolder);

		let created = 0;
		let existed = 0;
		let skipped = 0;

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

		return { created, existed, skipped };
	}

	private async ensureFolder(path: string) {
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFolder) return;
		await this.app.vault.createFolder(path);
	}

	private sanitizeFilename(name: string): string {
		return name.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
	}

	private buildFilename(meeting: FathomMeeting): string {
		const date = moment(meeting.created_at).format('YYYY-MM-DD');
		const time = moment(meeting.created_at).format('HHmm');
		const title = meeting.title || meeting.meeting_title || 'Untitled Meeting';

		return this.sanitizeFilename(
			this.settings.fileNameFormat
				.replace('{{date}}', date)
				.replace('{{time}}', time)
				.replace('{{title}}', title)
		);
	}

	private async createOrUpdateMeetingNote(meeting: FathomMeeting): Promise<MeetingInput | null> {
		const filename = this.buildFilename(meeting);
		const filePath = `${this.settings.meetingFolder}/${filename}.md`;

		// Skip if file already exists
		const existing = this.app.vault.getAbstractFileByPath(filePath);
		if (existing) return null;

		// Fetch detailed data per-recording via dedicated endpoints
		let summary: string | null = null;
		let transcript: FathomTranscriptItem[] | null = null;

		if (this.settings.includeSummary) {
			summary = await this.fetchSummary(meeting.recording_id);
		}
		if (this.settings.includeTranscript) {
			if (this.settings.includeSummary) await this.delay(300);
			transcript = await this.fetchTranscript(meeting.recording_id);
		}

		// Use inline action items from the list response
		const actionItems = this.settings.includeActionItems ? meeting.action_items : null;

		const content = this.buildNoteContent(meeting, summary, transcript, actionItems);
		await this.app.vault.create(filePath, content);
		return {
			path: filePath,
			attendees: (meeting.calendar_invitees ?? []).map(inv => ({ name: inv.name ?? '', email: inv.email ?? '' })),
			recordedByEmail: meeting.recorded_by?.email,
		};
	}

	private buildNoteContent(
		meeting: FathomMeeting,
		summary: string | null,
		transcript: FathomTranscriptItem[] | null,
		actionItems: FathomActionItem[] | null
	): string {
		const lines: string[] = [];

		// ── Frontmatter ──
		lines.push('---');
		// Ecosystem routing fields (FRONTMATTER-SPEC: vault, type, status, tags are required).
		// vault is the vault the plugin runs in, so the note never reads as misplaced to /housekeep.
		lines.push(`vault: ${this.app.vault.getName()}`);
		lines.push('type: meeting');
		lines.push('status: complete');
		lines.push(`title: "${this.escapeYaml(meeting.title || meeting.meeting_title)}"`);
		lines.push(`recording_id: ${meeting.recording_id}`);
		lines.push(`date: ${moment(meeting.created_at).format('YYYY-MM-DD')}`);
		lines.push(`start_time: ${meeting.recording_start_time || meeting.scheduled_start_time}`);
		lines.push(`end_time: ${meeting.recording_end_time || meeting.scheduled_end_time}`);
		lines.push(`language: ${meeting.transcript_language || 'en'}`);
		lines.push(`recorded_by: "${this.escapeYaml(meeting.recorded_by?.name ?? 'Unknown')}"`);
		lines.push(`fathom_url: "${meeting.url}"`);
		lines.push(`share_url: "${meeting.share_url}"`);

		if (meeting.calendar_invitees?.length) {
			lines.push('attendees:');
			for (const inv of meeting.calendar_invitees) {
				lines.push(`  - name: "${this.escapeYaml(inv.name)}"`);
				lines.push(`    email: "${inv.email}"`);
				lines.push(`    external: ${inv.is_external}`);
			}
		}

		lines.push('tags:');
		lines.push('  - fathom');
		lines.push('  - meeting');
		lines.push('---');
		lines.push('');

		// ── Summary ──
		if (summary) {
			lines.push('## Summary');
			lines.push('');
			lines.push(summary);
			lines.push('');
		}

		// ── Action Items ──
		if (actionItems?.length) {
			lines.push('## Action Items');
			lines.push('');
			for (const item of actionItems) {
				const checkbox = item.completed ? '- [x]' : '- [ ]';
				// assignee is an object ({name, email, team}, all nullable) — not a string.
				// Interpolating it directly yields "[object Object]".
				const assigneeName = item.assignee?.name || item.assignee?.email || '';
				const assignee = assigneeName ? ` *(${assigneeName})*` : '';
				const ts = item.recording_timestamp ? ` \`${item.recording_timestamp}\`` : '';
				lines.push(`${checkbox} ${item.description}${assignee}${ts}`);
			}
			lines.push('');
		}

		// ── Attendees ──
		if (meeting.calendar_invitees?.length) {
			lines.push('## Attendees');
			lines.push('');
			lines.push('| Name | Email | External |');
			lines.push('|------|-------|----------|');
			for (const inv of meeting.calendar_invitees) {
				lines.push(`| ${inv.name} | ${inv.email} | ${inv.is_external ? 'Yes' : 'No'} |`);
			}
			lines.push('');
		}

		// ── Transcript ──
		if (transcript?.length) {
			lines.push('## Transcript');
			lines.push('');
			for (const entry of transcript) {
				const speaker = entry.speaker.display_name;
				lines.push(`**${speaker}** \`${entry.timestamp}\``);
				lines.push(`${entry.text}`);
				lines.push('');
			}
		}

		// ── Footer ──
		lines.push('---');
		lines.push(`*Synced from [Fathom](${meeting.url}) on ${moment().format('YYYY-MM-DD HH:mm')}*`);
		lines.push('');

		return lines.join('\n');
	}

	private escapeYaml(s: string): string {
		return s.replace(/"/g, '\\"');
	}
}

// ─── Settings Tab ───────────────────────────────────────────────────────────

// Settings stored as vault paths: no leading or trailing slash.
const PATH_KEYS = ['meetingFolder', 'contactsFolder', 'directoryCsvPath', 'reportFolder'];

class FathomSyncSettingTab extends PluginSettingTab {
	plugin: FathomSyncPlugin;

	constructor(app: App, plugin: FathomSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getControlValue(key: string): unknown {
		if (key === 'selfEmails') return this.plugin.settings.selfEmails.join('\n');
		return super.getControlValue(key);
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (PATH_KEYS.includes(key)) value = String(value).trim().replace(/^\/|\/$/g, '');
		if (key === 'directoryOrg') value = String(value).trim();
		if (key === 'selfEmails') value = String(value).split('\n').map((s) => s.trim()).filter(Boolean);
		await super.setControlValue(key, value);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'API key',
				desc: 'Your Fathom API key (found in Fathom → Settings → Integrations).',
				aliases: ['token', 'Fathom key'],
				render: (setting) => {
					setting.addText((text) =>
						text
							.setPlaceholder('Enter your Fathom API key')
							.setValue(this.plugin.settings.apiKey)
							.then((t) => { t.inputEl.type = 'password'; })
							.onChange(async (value) => {
								this.plugin.settings.apiKey = value;
								await this.plugin.saveSettings();
							})
					);
				},
			},
			{
				name: 'Meeting folder',
				desc: 'Vault folder where meeting notes will be created.',
				control: { type: 'folder', key: 'meetingFolder', placeholder: 'Meetings/Fathom' },
			},
			{
				name: 'File name format',
				desc: 'Template for the note file name. Available: {{date}}, {{time}}, {{title}}.',
				control: {
					type: 'text',
					key: 'fileNameFormat',
					placeholder: '{{date}} — {{title}}',
					validate: (v) => (v.trim() ? undefined : 'A file name format is required.'),
				},
			},
			{
				type: 'group',
				heading: 'Note contents',
				items: [
					{
						name: 'Include summary',
						desc: 'Fetch and embed the AI-generated meeting summary.',
						control: { type: 'toggle', key: 'includeSummary' },
					},
					{
						name: 'Include transcript',
						desc: 'Fetch and embed the full meeting transcript.',
						control: { type: 'toggle', key: 'includeTranscript' },
					},
					{
						name: 'Include action items',
						desc: 'Embed action items as a checklist.',
						control: { type: 'toggle', key: 'includeActionItems' },
					},
				],
			},
			{
				name: 'Sync on startup',
				desc: 'Automatically sync the last 7 days of meetings when Obsidian starts.',
				control: { type: 'toggle', key: 'syncOnStartup' },
			},
			{
				type: 'page',
				name: 'Attendee linking',
				desc: 'Link meeting attendees to Contact records by email.',
				// Preview and backfill refuse to run until Your emails is set.
				status: () => (this.plugin.settings.selfEmails.length ? null : 'warning'),
				items: [
					{
						name: 'Link attendees on sync',
						desc: 'After each sync, add Related: [[Name]] lines for attendees with a Contact record.',
						control: { type: 'toggle', key: 'linkOnSync' },
					},
					{
						name: 'Your emails',
						desc: 'One per line. Never linked. Required before Preview or Link attendees will run.',
						aliases: ['self emails', 'my email'],
						control: {
							type: 'textarea',
							key: 'selfEmails',
							rows: 3,
							validate: (v) => {
								const bad = v.split('\n').map((s) => s.trim()).filter((s) => s && !s.includes('@'));
								return bad.length ? `Not an email: ${bad.join(', ')}` : undefined;
							},
						},
					},
					{
						name: 'Contacts folder',
						desc: 'Folder holding person and organization records.',
						control: { type: 'folder', key: 'contactsFolder' },
					},
					{
						name: 'Directory CSV path',
						desc: 'Faculty-staff directory export used to create Maryville contacts.',
						aliases: ['faculty staff directory'],
						control: { type: 'file', key: 'directoryCsvPath', filter: (f) => f.extension === 'csv' },
					},
					{
						name: 'Directory organization',
						desc: 'Organization written on contacts created from the directory.',
						control: { type: 'text', key: 'directoryOrg' },
					},
					{
						name: 'Report folder',
						desc: 'Where the preview and the run log are written.',
						control: { type: 'folder', key: 'reportFolder' },
					},
					{
						type: 'list',
						heading: 'Ignored emails',
						emptyState: 'Nobody ignored. The review modal adds people here; delete one to be asked about them again.',
						items: this.plugin.settings.ignoredEmails.map((email) => ({ name: email })),
						onDelete: async (index) => {
							this.plugin.settings.ignoredEmails.splice(index, 1);
							await this.plugin.saveSettings();
							this.update();
						},
					},
				],
			},
		];
	}
}
