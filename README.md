# Fathom Sync

An Obsidian plugin that syncs your [Fathom AI](https://fathom.video) meeting recordings into your vault as structured markdown notes — complete with AI summaries, transcripts, action items, and attendee info.

## AI Usage
This plugin was 100% vibe coded. This is only intended for my personal use and I don't take issues or pull requests.

## Features

- **Full meeting sync** — paginated fetch of all meetings from the Fathom API
- **Rich note content** — YAML frontmatter, AI-generated summaries, speaker-attributed transcripts, and action item checklists
- **Per-recording detail** — summaries and transcripts are fetched from dedicated endpoints for richer data (e.g., speaker email matching)
- **Idempotent** — existing notes are never overwritten; only new meetings create new files
- **Configurable** — choose your folder, file naming template, and which sections to include
- **Optional auto-sync** — sync the last 7 days of meetings automatically on startup

## Requirements

Obsidian 1.13.2 or later.

## Installation

### From source

```bash
# Clone into your vault's plugins directory
cd /path/to/your-vault/.obsidian/plugins
git clone https://github.com/YOUR_USERNAME/fathom-sync.git
cd fathom-sync

# Install dependencies and build
npm install
npm run build
```

Then in Obsidian: **Settings → Community plugins → Enable** "Fathom Sync".

### Development

```bash
npm run dev   # Watch mode — rebuilds on file changes
```

Use the [Hot-Reload plugin](https://github.com/pjeby/hot-reload) in your dev vault for automatic reloading.

## Setup

1. Get your Fathom API key from **Fathom → Settings → Integrations**
2. Open **Obsidian → Settings → Fathom Sync**
3. Set your API key under **API key** (Obsidian keeps it in its secret storage)
4. Configure the meeting folder and other options as needed

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| **API key** | — | Your Fathom API key, kept in Obsidian's secret storage on this device (not in `data.json`). A key saved by 1.5.x or earlier moves there automatically on first load. |
| **Meeting folder** | `Meetings/Fathom` | Vault path where meeting notes are created |
| **File name format** | `{{date}} — {{title}}` | Template for note filenames (see [placeholders](#file-name-placeholders)) |
| **Include summary** | On | Fetch and embed the AI-generated summary |
| **Include transcript** | On | Fetch and embed the full speaker-attributed transcript |
| **Include action items** | On | Embed action items as an Obsidian checklist |
| **Sync on startup** | Off | Automatically sync the last 7 days when Obsidian starts |
| **Link attendees on sync** | On | After each sync, link meeting attendees to Contact records |
| **Your emails** | — | One per line. Never linked. Required before attendee preview or backfill will run |
| **Contacts folder** | `30-REFERENCE/Contacts` | Folder holding person and organization records |
| **Directory CSV path** | `70-PROJECTS/Maryville Institutional AI/faculty-staff/faculty-staff.csv` | Faculty-staff directory export used to create contacts |
| **Directory organization** | `Maryville University` | Organization written on contacts created from the directory |
| **Report folder** | `90-SYSTEM/fathom-sync` | Where the preview and the run log are written |
| **Ignored emails** | — | People the review modal told the linker to skip; delete one to be asked again |

### File name placeholders

| Placeholder | Output | Example |
|-------------|--------|---------|
| `{{date}}` | `YYYY-MM-DD` | `2026-03-16` |
| `{{time}}` | `HHmm` | `1430` |
| `{{title}}` | Meeting title | `Weekly Sync` |

## Usage

### Commands

Open the Command Palette (`Cmd/Ctrl+P`) and search for:

| Command | Description |
|---------|-------------|
| **Fathom Sync: Sync new meetings** | Fetches meetings created since the last sync |
| **Fathom Sync: Sync all meetings (full re-sync)** | Fetches every meeting from your account; existing notes are left alone |
| **Fathom Sync: Preview attendee linking for all meeting notes** | Writes `90-SYSTEM/fathom-sync/attendee-link-preview.md`; changes nothing else |
| **Fathom Sync: Link attendees in all meeting notes** | Backfills every existing meeting note |

There is also a **ribbon icon** (video camera) in the left sidebar for one-click sync of new meetings.

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

### Generated note structure

Each meeting creates a markdown file like this:

```markdown
---
title: "Weekly Sync"
recording_id: 123456
date: 2026-03-10
start_time: 2026-03-10T14:01:12Z
end_time: 2026-03-10T14:58:45Z
language: en
recorded_by: "Alice Johnson"
fathom_url: "https://fathom.video/..."
share_url: "https://fathom.video/share/..."
attendees:
  - name: "Bob Smith"
    email: "bob@partner.com"
    external: true
tags:
  - fathom
  - meeting
---

## Summary

## Key Points
- Budget was approved
- Next steps outlined

## Action Items

- [ ] Send follow-up email *(alice@acme.com)* `00:12:45`

## Attendees

| Name | Email | External |
|------|-------|----------|
| Bob Smith | bob@partner.com | Yes |

## Transcript

**Alice Johnson** `00:05:32`
Let's revisit the budget allocations.

**Bob Smith** `00:05:38`
Sounds good. I have the numbers ready.

---
*Synced from [Fathom](https://fathom.video/...) on 2026-03-16 14:30*
```

## How it works

1. **List meetings** — calls `GET /meetings` with cursor-based pagination, requesting action items inline
2. **Fetch details** — for each meeting, calls the dedicated `/recordings/{id}/summary` and `/recordings/{id}/transcript` endpoints (these return richer data than the inline fields, including speaker email matching)
3. **Create notes** — generates a markdown file with YAML frontmatter and structured sections
4. **Skip duplicates** — if a file already exists at the expected path, it is not overwritten

## API endpoints used

| Endpoint | Purpose |
|----------|---------|
| `GET /meetings` | List meetings with pagination and filtering |
| `GET /recordings/{id}/summary` | Fetch AI-generated summary per recording |
| `GET /recordings/{id}/transcript` | Fetch full transcript with speaker attribution |

All requests authenticate via the `X-Api-Key` header. See [Fathom API docs](https://fathom.video) for details.

## License

MIT
