# Fathom AI API — Endpoint Documentation

**Base URL:** `https://api.fathom.ai/external/v1`

## Authentication

All endpoints support two authentication methods:

- **API Key:** `X-Api-Key: <your-api-key>` header
- **Bearer Token:** `Authorization: Bearer <token>` header

---

## 1. List Meetings

**`GET /meetings`**

Returns a paginated list of meetings with optional filtering and embedded data.

### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `cursor` | string | No | — | Pagination cursor from a previous response's `next_cursor` |
| `created_after` | string (ISO 8601) | No | — | Only meetings created after this timestamp |
| `created_before` | string (ISO 8601) | No | — | Only meetings created before this timestamp |
| `recorded_by[]` | string (email) | No | — | Filter by recorder email(s). Pass once per value. |
| `teams[]` | string | No | — | Filter by team name(s). Pass once per value. |
| `calendar_invitees_domains[]` | string | No | — | Filter by company domain(s) (exact match). Pass once per value. |
| `calendar_invitees_domains_type` | string | No | `all` | Domain filter mode: `all`, `only_internal`, or `one_or_more_external` |
| `include_summary` | boolean | No | `false` | Embed the default summary in each meeting. **Not available for OAuth apps** (use `/recordings/{id}/summary` instead). |
| `include_transcript` | boolean | No | `false` | Embed the transcript in each meeting. **Not available for OAuth apps** (use `/recordings/{id}/transcript` instead). |
| `include_action_items` | boolean | No | `false` | Embed action items for each meeting. |
| `include_crm_matches` | boolean | No | `false` | Embed CRM match data (requires linked CRM). |

### Response — `200 OK`

```jsonc
{
  "limit": 25,              // integer | null — page size
  "next_cursor": "abc123",  // string | null — pass as `cursor` for the next page
  "items": [                // array of Meeting objects
    {
      "title": "Weekly Sync",
      "meeting_title": "Weekly Sync",
      "recording_id": 123456,
      "url": "https://fathom.video/...",
      "share_url": "https://fathom.video/share/...",

      // Timestamps (ISO 8601)
      "created_at": "2026-03-10T14:00:00Z",
      "scheduled_start_time": "2026-03-10T14:00:00Z",
      "scheduled_end_time": "2026-03-10T15:00:00Z",
      "recording_start_time": "2026-03-10T14:01:12Z",
      "recording_end_time": "2026-03-10T14:58:45Z",

      "calendar_invitees_domains_type": "one_or_more_external", // or "only_internal"
      "transcript_language": "en",

      // Embedded (when requested via include_* params)
      "transcript": [                // array | null
        {
          "speaker": "Alice Johnson",
          "text": "Let's revisit the budget.",
          "timestamp": "00:05:32"     // HH:MM:SS from recording start
        }
      ],
      "default_summary": {            // object | null
        "template_name": "general",
        "markdown_formatted": "## Key Points\n- ..."
      },
      "action_items": [               // array | null
        {
          "description": "Send follow-up email",
          "user_generated": false,
          "completed": false,
          "recording_timestamp": "00:12:45",
          "recording_playback_url": "https://...",
          "assignee": "alice@acme.com"
        }
      ],

      // Attendees
      "calendar_invitees": [
        {
          "name": "Bob Smith",
          "email": "bob@partner.com",
          "email_domain": "partner.com",
          "is_external": true
        }
      ],
      "recorded_by": {
        "name": "Alice Johnson",
        "email": "alice@acme.com",
        "email_domain": "acme.com",
        "team": "Sales"
      },

      // CRM (when requested)
      "crm_matches": {                // object | null
        "contacts": [],
        "companies": [],
        "deals": [],
        "error": null
      }
    }
  ]
}
```

### Pagination

Use cursor-based pagination. When `next_cursor` is non-null, pass it as the `cursor` query parameter to retrieve the next page.

### Errors

| Code | Meaning |
|------|---------|
| 400 | Invalid query parameters |
| 401 | Missing or invalid authentication |
| 429 | Rate limited |

---

## 2. Get Recording Summary

**`GET /recordings/{recording_id}/summary`**

Retrieves the AI-generated summary for a specific meeting recording. Supports both synchronous (direct response) and asynchronous (webhook callback) modes.

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `recording_id` | integer | Yes | The ID of the meeting recording |

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `destination_url` | string (URI) | No | If provided, Fathom will POST the summary to this URL instead of returning it directly (async mode). |

### Response — `200 OK`

**Synchronous mode** (no `destination_url`):

```json
{
  "summary": {
    "template_name": "general",
    "markdown_formatted": "## Key Points\n- Budget was approved\n- Next steps outlined"
  }
}
```

- `summary.template_name` — string | null — the summary template used (e.g. `"general"`)
- `summary.markdown_formatted` — string | null — the summary content in Markdown. Always in English.

**Asynchronous mode** (with `destination_url`):

```json
{
  "destination_url": "https://your-server.com/webhook/summary"
}
```

Fathom will POST the summary payload to your `destination_url` when ready.

### Errors

| Code | Meaning |
|------|---------|
| 400 | Invalid query parameters |
| 401 | Missing or invalid authentication |
| 429 | Rate limited |

---

## 3. Get Recording Transcript

**`GET /recordings/{recording_id}/transcript`**

Retrieves the full transcript for a specific meeting recording. Like the summary endpoint, supports synchronous and asynchronous modes.

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `recording_id` | integer | Yes | The ID of the meeting recording |

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `destination_url` | string (URI) | No | If provided, Fathom will POST the transcript to this URL instead of returning it directly (async mode). |

### Response — `200 OK`

**Synchronous mode** (no `destination_url`):

```json
{
  "transcript": [
    {
      "speaker": {
        "display_name": "Alice Johnson",
        "matched_calendar_invitee_email": "alice.johnson@acme.com"
      },
      "text": "Let's revisit the budget allocations.",
      "timestamp": "00:05:32"
    },
    {
      "speaker": {
        "display_name": "Bob Smith",
        "matched_calendar_invitee_email": null
      },
      "text": "Sounds good. I have the numbers ready.",
      "timestamp": "00:05:38"
    }
  ]
}
```

Each transcript item contains:

- `speaker.display_name` — string — the speaker's name
- `speaker.matched_calendar_invitee_email` — string | null — email if matched to a calendar invitee
- `text` — string — what was spoken
- `timestamp` — string — `HH:MM:SS` relative to the start of the recording

**Asynchronous mode** (with `destination_url`):

```json
{
  "destination_url": "https://your-server.com/webhook/transcript"
}
```

Fathom will POST the transcript payload to your `destination_url` when ready.

### Errors

| Code | Meaning |
|------|---------|
| 400 | Invalid query parameters |
| 401 | Missing or invalid authentication |
| 429 | Rate limited |

---

## Notes

- **Transcript speaker format differs** between the List Meetings endpoint (flat `speaker` string) and the Get Transcript endpoint (nested `speaker` object with `display_name` and `matched_calendar_invitee_email`).
- **OAuth apps** cannot use `include_summary` or `include_transcript` on the List Meetings endpoint — use the dedicated `/recordings/{id}/summary` and `/recordings/{id}/transcript` endpoints instead.
- **Summaries are always in English** regardless of the meeting's transcript language.
- All timestamps in transcripts use `HH:MM:SS` format relative to recording start.
