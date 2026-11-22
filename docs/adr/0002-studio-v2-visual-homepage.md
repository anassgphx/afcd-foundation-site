# ADR 0002: Studio V2, a section-based visual homepage editor

Status: accepted for the first workflow (phase 1 to 4 below). Later phases are planned, not built.

## Current state (audit, 22 November 2026)

What exists and is reused:

| Area | Today | Reuse |
|---|---|---|
| Public site | Static HTML. `src/content.py` generates most pages, `src/pages/index.html` is hand-written, `build.mjs` wraps pages with partials. **Not Astro.** | Kept as is. No rebuild. |
| Block registry | `studio/src/server/modules/pages/blocks.ts`: 13 typed, versioned blocks (zod schema, defaults, field metadata, server renderer, version upgrades). Used by custom pages. | Becomes the homepage section library. |
| Visual canvas | Builder: server-rendered canvas with the real partials and CSS, click-to-select, device widths, undo/redo, field editors. | Reused for the homepage. |
| Homepage editing (V1) | 67 `data-sf` fields in `index.html`, edited values in `page_contents.values`, review, revisions, preview, verified publishing via `src/data/page-fields.json` applied by `build.mjs`. | Kept. Section fields are edited in the inspector. |
| Workflow | draft → in review → changes requested / approved → published, no self-approval, immutable revisions, restore creates a draft, verified delivery with rollback. | Kept, plus a concurrency check. |

Technical debt found: the page-fields code lived inline in `build.mjs` and had no TypeScript twin, so Studio could not render a faithful canvas of the homepage; saves had no conflict detection; the homepage editor had no structure (only fields).

## Decision

1. **The homepage is a list of sections.** Each item is either a *site section* (one of the hand-written top-level `<section id="…">` of `index.html`, addressed by its id) or a *block* from the registry (stable random id, type, version, props). Order is position in the list; identity never depends on position. Site sections can be moved and hidden, not deleted; blocks can be added, duplicated, moved, hidden and removed.
2. **Storage.** `page_contents.layout` (new, nullable JSON) holds the list; `values` keeps the field edits. Revisions snapshot `{ values, layout }`. A revision without `layout` means "the page as written", so every existing revision keeps working (no data migration needed).
3. **One composition engine.** `lib/page-fields.mjs` (plain JS, no dependencies) applies field values and composes sections. `build.mjs` imports it for the live site; Studio imports the same file for the canvas. Preview and production cannot drift.
4. **Safe output.** Blocks are rendered by Studio's registry renderers (escaped, URL allow-list) and stored as HTML in `page-fields.json` only for live revisions. Unknown block types never render. Editors cannot enter HTML, CSS or scripts.
5. **New hand-written sections** that are not in a saved layout appear at their source position, so website changes are never hidden by an old layout.
6. **Conflicts.** Saves carry the `updatedAt` the editor loaded; a newer save by someone else is refused, never overwritten.

## Phases

1. Audit (this note). 2. Section model and composition. 3. Visual editor: navigator, live canvas (desktop, tablet, mobile), inspector for site-section fields and block props. 4. First workflow end to end: add section → choose block → edit → preview → save → review → approve → publish → verify live. **Built.**

Planned next, in order: autosave with explicit states; revision comparison; dynamic sources for blocks (latest stories, upcoming events, open opportunities, partners), reusing canonical records; reusable patterns and shared sections; hero slide manager (add or remove slides needs the hand-written slider to become a block); navigation and footer builder; templates with locked sections; MFA when hosted.

## Trade-offs

- The hand-written sections stay owned by the website team. Studio edits their marked fields and their order and visibility, not their internal layout. Fully free-form editing of those sections would mean converting each one into a registry block, which can be done one section at a time later.
- Delivery stays static generation on publish (fast, crawlable, no database on public requests). The cost is a rebuild per publish (seconds).
