# CLAUDE.md

## Project Purpose

**fathom-sync** is an Obsidian plugin that syncs meeting recordings from the [Fathom AI](https://fathom.video) external API into a vault as structured markdown notes — with summaries, transcripts, action items, and attendee info.

## Project Structure

Standard Obsidian plugin layout:
- `src/main.ts` — Plugin entry point (all logic)
- `manifest.json` — Obsidian plugin metadata
- `styles.css` — Plugin styles
- `main.js` — Generated build output (do not edit)
- `docs/` — Reference documentation

## API Reference

- `docs/fathom-api-endpoints.md` — Full endpoint documentation for the Fathom external API (v1)
- `docs/obsidian-plugin-reference.md` — Obsidian plugin development reference
- **Base URL:** `https://api.fathom.ai/external/v1`
- **Auth:** API key (`X-Api-Key` header) or Bearer token

## Vault Ecosystem

This project is part of a broader Obsidian vault ecosystem for knowledge management. The vaults are accessible via MCP servers configured in `.mcp.json`:

| Vault | MCP Server | Purpose |
|-------|-----------|---------|
| field-notes | `obsidian-field-notes` | Intake layer — captures, web clips |
| mnemosyne | `obsidian-mnemosyne` | Personal KB — tech docs, skills, patterns |
| cursus-opus | `obsidian-cursus-opus` | Professional work |
| grimoire-arcanum | `obsidian-grimoire-arcanum` | D&D worldbuilding, creative |
| phylactery | `obsidian-phylactery` | Private, personal |

Shared skills (like `/housekeep` and `/move-this`) live in `mnemosyne/00-SKILLS/` and are available globally via `~/.claude/skills/`.
