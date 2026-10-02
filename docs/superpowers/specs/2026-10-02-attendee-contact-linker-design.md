---
status: draft
date: 2026-10-02
feature: attendee-contact-linker
---

# Attendee → Contact linker — design

## Problem

Every meeting note fathom-sync writes carries structured `attendees[]` frontmatter (name, email, external). Linking those attendees to Contact records in `30-REFERENCE/Contacts/` is done by hand today, as `end-day` Step 5: Claude searches Contacts for each attendee, writes a `Related: [[Name]]` line under the frontmatter, and asks before creating any missing contact. It is deterministic work done with judgment-priced effort, every day.

State of the vault on 2026-10-02:

- **Meeting notes:** 1,169 in `20-PERIODIC/meetings`. 653 carry at least one `Related:` line (1,830 lines in total, every one of the form `Related: [[Name]]`, one per line, directly under the closing `---`). 297 have no `attendees` frontmatter (pre-Fathom). There are 558 `external: true` attendee entries.
- **Contacts:** 297 person records (`document_type: contact`, a single `email:` field, filename `First Last.md`; 3 lack an email), 54 organizations (with a `website:` field in inconsistent formats), 1 group.
- **Directory:** `70-PROJECTS/Maryville Institutional AI/faculty-staff/faculty-staff.csv`, 2,007 rows with `firstName`, `lastName`, `jobTitle`, `email`, `departmentDesc1`, `phone`, `HR_EffectiveTerminationDate` and more. Values contain HTML entities (`&amp;`).

Each contact's `### Meetings` dataview already finds its meetings by email, so the contact → meeting direction works. What's missing is meeting → contact: backlinks, the graph, `### Mentioned In`, and not doing this by hand.

## Goals

1. Link attendees to contacts automatically on every newly synced meeting note.
2. Backfill the existing meeting notes with one command.
3. Create Maryville contacts from the directory without asking. Ask about externals once, and never again about anyone declined.
4. Never damage a note: additive writes only, idempotent, a preview before any bulk write, and a log of what changed.

## Non-goals

- Creating organization records. Orgs are only *linked*, by email domain, when a record already exists (memory: CRM org records exist only for orgs Maryville works with).
- Matching attendees by display name. Fathom names are unreliable (`Bronson, Sara E.` vs `Sara Bronson`); email is the only key.
- Linking meetings that have no Fathom note (calendar-only). `end-day` keeps those.
- An undo command. The log is enough to reverse a run by hand.
- Running Templater or Modal Forms. The plugin writes the Contact template's output itself.

## Decisions

| # | Decision | Why |
|---|----------|-----|
| D1 | New notes at sync time **and** a backfill command | One command clears the 516 Fathom notes without links; `end-day` Step 5 shrinks to leftovers |
| D2 | Directory matches are **created automatically**; only externals are asked about | Brian's choice (option C). This supersedes `end-day`'s "ask before creating" for Maryville staff |
| D3 | Externals: one review modal per run, everyone **unchecked**; unchecked people are added to an **ignore list** | The first backfill asks once at length; later syncs usually ask about zero to two people |
| D4 | Link format is the existing convention, `Related: [[Name]]`, one per line, directly under the frontmatter | Matches all 1,830 existing lines; old and new notes stay uniform |
| D5 | The logic lives in a module under `src/attendees/`, called from `main.ts` | Keeps `main.ts` readable and lets the matching rules be unit-tested without Obsidian |

## Architecture

New files under `src/attendees/`:

| File | Responsibility | Depends on |
|------|----------------|------------|
| `normalize.ts` | `normalizeEmail` (trim, lowercase), `domainOf(email)`, `domainFromWebsite(website)` (strip quotes, protocol, `www.`, path, trailing slash) | nothing (pure) |
| `directory.ts` | Parse the faculty-staff CSV into `Map<email, DirectoryPerson>`; decode HTML entities; handle quoted fields | nothing (pure; takes CSV text) |
| `related.ts` | `insertRelatedLines(content, names): string`. Inserts missing `Related: [[Name]]` lines directly after the closing frontmatter `---`, after any existing `Related:` lines, skipping names already linked | nothing (pure) |
| `planner.ts` | `plan(meetings, index, directory, settings): LinkPlan`. Decides per attendee: link, auto-create (directory), queue (external), or skip (self, ignored). Dedupes people across meetings and flags name collisions | pure |
| `contactTemplate.ts` | Render a person Contact note body from a directory row or an approved external | pure |
| `index.ts` | Build `ContactIndex` from the metadata cache: `email → file` for person records, `domain → org name` for organizations | Obsidian `App` |
| `linker.ts` | Execute a plan: create contacts, apply `insertRelatedLines` through `vault.process`, write the preview or log, return counts | Obsidian `App` |
| `ReviewModal.ts` | The externals review modal | Obsidian `Modal` |

`main.ts` changes:

- `createOrUpdateMeetingNote` collects `{ path, invitees }` for each note it creates. After `processMeetings` finishes, `syncNewMeetings` and `syncAllMeetings` hand the batch to the linker. This uses the Fathom API's invitees directly, not the metadata cache, which may not have indexed a just-created file yet.
- Two new commands: **Preview attendee linking for all meeting notes** and **Link attendees in all meeting notes**. Both read `attendees` from the frontmatter of each note in `meetingFolder`, skipping notes with none.
- New settings (see below).

## Matching rules (planner)

For each attendee email, in order:

1. **Skip** if the email is one of the user's own (setting `selfEmails`). At sync time an empty setting falls back to the API's `recorded_by.email`. Note frontmatter stores `recorded_by` as a name only, so the Preview and backfill commands **refuse to run while `selfEmails` is empty**, with a Notice pointing at the setting.
2. **Skip** if the email is on `ignoredEmails`.
3. **Link** if `ContactIndex` has a person record for the email.
4. **Auto-create, then link** if the directory has the email and `Contacts/First Last.md` does not exist.
5. **Queue as a name collision** if the directory has the email but `First Last.md` already exists with a different email (or none). It is never overwritten and never auto-created.
6. **Queue as external** otherwise. The queue entry shows name, email, domain, and the org whose `website` domain matches, if any.

A person who appears in many meetings is planned once. Every meeting they attended is recorded against them, so approving them in the modal links all of those meetings. Contacts created during the run are added to the in-memory index immediately.

## Contact notes the plugin creates

Filename `First Last.md` in `contactsFolder`. The body reproduces `90-SYSTEM/templates/Contact.md` output field for field: frontmatter (`first_name`, `last_name`, `full_name`, `pronouns`, `email`, `phone`, `linkedin`, `organization`, `title_position`, `relationship_nature`, `reports_to`, `division`, `department`, `team`, `location`, `met_through`, `birthday`, `date_created`, `date_modified`, `document_type: contact`, `status`, `aliases`, `tags: contact`), plus **`vault: cursus-opus`** (the template omits it; the frontmatter spec requires it). Then the heading, the Affiliations table, Notes, and `## Related` with the `<!-- contact-related-queries v1 -->` block, with the person's email filled into the Meetings query.

- **From the directory:** `title_position` = `jobTitle`, `department` = `departmentDesc1`, `phone`, `organization: Maryville University`, and `status: inactive` when `HR_EffectiveTerminationDate` is set (`active` otherwise). Notes gets the line `- Created from faculty-staff directory by fathom-sync (YYYY-MM-DD)`.
- **Approved external:** name split on the last space (`Last, First` is reversed first), `email`, and `organization` set to the matched org name or left blank. The Affiliations row links `[[Org]]` only when an org record exists. Notes gets `- Created from meeting attendees by fathom-sync (YYYY-MM-DD)`.
- **Existing file at create time:** if `First Last.md` exists when a create runs (for example, it was made by hand between the plan and the modal), the create is skipped and counted as failed. Nothing is ever overwritten.

## Review modal

Opens at the end of a sync or a real backfill run, and only if the queue is non-empty.

- Two groups: **Name collisions** (shown first) and **Externals**.
  - **Name collisions are read-only.** Each shows the person, their email, and the path of the existing file that has their name. They can't be created (the filename is taken) and are never ignored, so they reappear each run until resolved by hand, for example by adding the email to the existing record or renaming it.
  - **Externals** each get a checkbox, unchecked by default, showing name, email, domain, matched org, and the number of meetings.
- **Create selected:** creates the checked externals, links them into all their meetings, adds every unchecked external's email to `ignoredEmails`, saves settings, and shows the summary.
- **Close without choosing:** nothing is created and nothing is ignored. The same people are offered next run.

## Preview and log

- **Preview** command: runs the planner over every meeting note and writes `90-SYSTEM/fathom-sync/attendee-link-preview.md` (overwritten each time). It lists contacts to create (with source), notes to change with the exact lines to add, and the people who would be queued. It writes nothing else.
- **Real run** (backfill or sync): appends a dated section to `90-SYSTEM/fathom-sync/attendee-link-log.md`, recording every file changed with the lines added, every contact created, and every email ignored. Every write is additive, so a run is reversed by deleting exactly what the log lists.
- The folder is a setting (`reportFolder`).

## Error handling

- Each note is in its own try/catch. A failure is logged to the console with the path, counted, and the run continues.
- At sync time, linker failures never fail the sync. The meeting note is already written and `lastSyncedAt` advances as it does today.
- A missing or unreadable directory CSV disables rule 4. Those people fall through to the queue, and the summary says the directory was unavailable.
- One Notice at the end: `Linked N notes · created N contacts · N to review · N failed`.

## Settings

| Setting | Default |
|---------|---------|
| Link attendees on sync | On |
| Contacts folder | `30-REFERENCE/Contacts` |
| Directory CSV path | `70-PROJECTS/Maryville Institutional AI/faculty-staff/faculty-staff.csv` |
| Directory organization name | `Maryville University` |
| Your emails | empty (falls back to `recorded_by`) |
| Report folder | `90-SYSTEM/fathom-sync` |
| Ignored emails | empty; editable list, so a mistaken ignore can be undone |

## Testing

- Add Vitest (dev dependency, `npm test`). Unit tests cover the pure modules:
  - `normalize`: case and whitespace; every `website` format present in the vault (`www.capacity.com`, `'burstiq.com'`, `https://www.1edtech.org/`, `adobe.com`).
  - `directory`: quoted fields, embedded commas, `&amp;`, missing columns.
  - `related`: inserts after the frontmatter; appends after existing `Related:` lines; is idempotent; leaves a note with no frontmatter unchanged and reports it.
  - `planner`: each rule 1–6; one person across several meetings; a contact created mid-run is linked, not re-created; the ignore list.
  - `contactTemplate`: output matches the template's field set, and the query block carries the email.
- **Manual acceptance:** build, run Preview on the real vault, spot-check about 10 notes and about 5 contacts in the report. Then run the real backfill, open about 10 changed notes and about 5 created contacts, confirm a created contact's Meetings dataview renders, and confirm a second backfill run reports `Linked 0 notes`.

## Follow-up outside this repo

`end-day` Step 5 shrinks to the leftovers: read the plugin's summary, handle meetings with no Fathom note, and drop "ask before creating" for directory matches (D2). That is a skill edit, routed through `skill-creator` after this ships, and not part of this plan.
