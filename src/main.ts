import { App, Notice, Plugin, PluginSettingTab, Setting, TFolder, moment, requestUrl } from 'obsidian';

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

interface FathomActionItem {
	description: string;
	user_generated: boolean;
	completed: boolean;
	recording_timestamp: string;
	recording_playback_url: string;
	assignee: string;
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

	async onload() {
		await this.loadSettings();
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

		if (this.settings.syncOnStartup && this.settings.apiKey) {
			// Delay to let vault fully load
			this.registerInterval(
				window.setTimeout(() => this.syncNewMeetings(), 5000) as unknown as number
			);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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

		const maxRetries = 3;
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			const resp = await requestUrl({
				url: url.toString(),
				headers: { 'X-Api-Key': this.settings.apiKey },
			});

			if (resp.status === 429) {
				if (attempt < maxRetries) {
					const wait = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
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

		const since = this.settings.lastSyncedAt;
		const label = since
			? `since ${moment(since).format('MMM D, h:mm A')}`
			: '(first sync)';
		new Notice(`Fathom Sync: Checking for new meetings ${label}...`);

		try {
			const meetings = await this.fetchAllMeetings(since ?? undefined);
			const { created, skipped } = await this.processMeetings(meetings);

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
		}
	}

	async syncAllMeetings() {
		if (!this.settings.apiKey) {
			new Notice('Fathom Sync: Please set your API key in settings.');
			return;
		}
		new Notice('Fathom Sync: Full re-sync — fetching all meetings...');
		try {
			const meetings = await this.fetchAllMeetings();
			const { created, skipped } = await this.processMeetings(meetings);

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
		}
	}

	private async processMeetings(meetings: FathomMeeting[]): Promise<{ created: number; existed: number; skipped: number }> {
		await this.ensureFolder(this.settings.meetingFolder);

		let created = 0;
		let existed = 0;
		let skipped = 0;

		for (let idx = 0; idx < meetings.length; idx++) {
			const meeting = meetings[idx]!;
			try {
				const wasCreated = await this.createOrUpdateMeetingNote(meeting);
				if (wasCreated) {
					created++;
					// Throttle between new notes to avoid rate limits
					if (idx < meetings.length - 1) await this.delay(500);
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

	private async createOrUpdateMeetingNote(meeting: FathomMeeting): Promise<boolean> {
		const filename = this.buildFilename(meeting);
		const filePath = `${this.settings.meetingFolder}/${filename}.md`;

		// Skip if file already exists
		const existing = this.app.vault.getAbstractFileByPath(filePath);
		if (existing) return false;

		// Fetch detailed data per-recording via dedicated endpoints
		let summary: string | null = null;
		let transcript: FathomTranscriptItem[] | null = null;

		if (this.settings.includeSummary) {
			summary = await this.fetchSummary(meeting.recording_id);
		}
		if (this.settings.includeTranscript) {
			transcript = await this.fetchTranscript(meeting.recording_id);
		}

		// Use inline action items from the list response
		const actionItems = this.settings.includeActionItems ? meeting.action_items : null;

		const content = this.buildNoteContent(meeting, summary, transcript, actionItems);
		await this.app.vault.create(filePath, content);
		return true;
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
				const assignee = item.assignee ? ` *(${item.assignee})*` : '';
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

class FathomSyncSettingTab extends PluginSettingTab {
	plugin: FathomSyncPlugin;

	constructor(app: App, plugin: FathomSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Fathom Sync Settings' });

		new Setting(containerEl)
			.setName('API Key')
			.setDesc('Your Fathom API key (found in Fathom → Settings → Integrations).')
			.addText((text) =>
				text
					.setPlaceholder('Enter your Fathom API key')
					.setValue(this.plugin.settings.apiKey)
					.then((t) => { t.inputEl.type = 'password'; })
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Meeting folder')
			.setDesc('Vault folder where meeting notes will be created.')
			.addText((text) =>
				text
					.setPlaceholder('Meetings/Fathom')
					.setValue(this.plugin.settings.meetingFolder)
					.onChange(async (value) => {
						this.plugin.settings.meetingFolder = value.replace(/^\/|\/$/g, '');
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('File name format')
			.setDesc('Template for the note file name. Available: {{date}}, {{time}}, {{title}}.')
			.addText((text) =>
				text
					.setPlaceholder('{{date}} — {{title}}')
					.setValue(this.plugin.settings.fileNameFormat)
					.onChange(async (value) => {
						this.plugin.settings.fileNameFormat = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Include summary')
			.setDesc('Fetch and embed the AI-generated meeting summary.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeSummary)
					.onChange(async (value) => {
						this.plugin.settings.includeSummary = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Include transcript')
			.setDesc('Fetch and embed the full meeting transcript.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeTranscript)
					.onChange(async (value) => {
						this.plugin.settings.includeTranscript = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Include action items')
			.setDesc('Embed action items as a checklist.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeActionItems)
					.onChange(async (value) => {
						this.plugin.settings.includeActionItems = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Sync on startup')
			.setDesc('Automatically sync the last 7 days of meetings when Obsidian starts.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.syncOnStartup)
					.onChange(async (value) => {
						this.plugin.settings.syncOnStartup = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
