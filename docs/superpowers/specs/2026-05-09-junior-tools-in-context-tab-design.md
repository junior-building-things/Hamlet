# Junior Tools in Context Tab — Design

**Status**: Proposed
**Date**: 2026-05-09
**Author**: Thomas (with Claude)

## Goal

Surface Junior's function-calling tool definitions in the existing **Junior Context** tab, alongside the messages and markdown files already shown there. Make it easy for the PM to see what capabilities Junior actually has at runtime.

Bundle in a small naming cleanup: rename `skill_*.md` files to just `*.md`. Persona vs Skills becomes an explicit allowlist instead of a filename prefix.

## Background

Junior's tools are defined in `junior/lib/gemini.ts` as a `FunctionDeclaration[]` (24 tools today: `get_my_features`, `read_document`, `create_feature`, etc.). They're passed to Gemini via the native function-calling channel:

```ts
ai.chats.create({
  config: {
    systemInstruction,                                // editable in Hamlet's Prompts tab
    tools: [{ functionDeclarations: tools }],         // not editable today
    ...
  },
});
```

Implications:

- Tools are global — every Junior turn sees all 24, the model picks via `AUTO` mode.
- Editing requires a code change + Junior redeploy. The Hamlet UI is read-only for tools.

Today the **Junior Context** tab (`components/JuniorContextView.tsx`) shows a flat list:

- 3 system cells (live chat snapshot, chat-level history, user-level history)
- All `*.md` files from `gs://tiktok-im-hamlet-state/junior/context/`

Files use a `skill_` prefix to distinguish capability files from persona files (`system.md`, `glossary.md`, `preferences.md`). The view checks `name.startsWith('skill_')` to render a skill-specific description.

## Design

### Categories

The view groups cells into four sections (in display order), each with a small-caps header + hairline divider:

1. **Messages** — chat history / snapshot fed in as user/model turns
   - Recent chat snapshot (live)
   - Conversation history (chat-level)
   - Conversation history (user-level)

2. **Persona** — markdown files merged into the system instruction (explicit allowlist)
   - `system.md`
   - `glossary.md`
   - `preferences.md`

3. **Skills** — every other `*.md` file (anything not in the persona allowlist)
   - e.g. `ab_analysis.md`, `prd_review.md`, `feature_lookup.md`

4. **Tools** — function declarations from Junior's `tools: FunctionDeclaration[]`, read-only

### Data flow for Tools

```
Junior repo                         hamlet-app
─────────────────────────         ─────────────────────────────
junior/lib/gemini.ts              app/api/junior-tools/route.ts
   tools: FunctionDeclaration[]      ├─ fetch Junior /api/tools
                                     ├─ short server-side cache (60s)
junior/app/api/tools/             └─ return JSON to client
   GET → { tools: [...] }
                                  components/JuniorContextView.tsx
                                     └─ fetch /api/junior-tools
                                         render Tools section
```

**Junior side** (one new file): `GET /api/tools` returns `{ tools: FunctionDeclaration[] }`. Just exports the existing constant — no transformation. Authentication: same pattern as Junior's other routes.

**Hamlet side** (one new file): `GET /api/junior-tools` proxies to `${process.env.JUNIOR_URL}/api/tools` with `Authorization: Bearer ${process.env.JUNIOR_CRON_SECRET}` — same pattern as `app/api/meego/sync/route.ts:214-215`. Server-side cache (60s TTL) so tab re-mounts don't hit Junior on every render. Returns the same JSON shape.

### Tool cell UX

**Collapsed row** (consistent with existing `.context-card`):

```
[icon]  tool_name (mono)             3 params · required ✓
        First sentence of description.
```

**Expanded** (click to toggle):

```
Full description text.

Parameters
─────────
doc_url           string · required
  Lark document URL (docx or wiki link)

section_heading   string · required
  The heading text of the section to edit

new_content       string · required
  The new content to replace the section body with
```

Visual: matches existing `.context-card` and `ContextCard` expand pattern. No edit affordances. Small inline note at the top of the Tools section: _Defined in `junior/lib/gemini.ts` — edit there._

### Skill rename: `skill_*.md` → `*.md`

The `skill_` prefix is referenced in several places. All need updating:

**GCS files** (5 today):
- `gs://tiktok-im-hamlet-state/junior/context/skill_ab_analysis.md` → `ab_analysis.md`
- `gs://tiktok-im-hamlet-state/junior/context/skill_chat_search.md` → `chat_search.md`
- `gs://tiktok-im-hamlet-state/junior/context/skill_explain_delay.md` → `explain_delay.md`
- `gs://tiktok-im-hamlet-state/junior/context/skill_feature_lookup.md` → `feature_lookup.md`
- `gs://tiktok-im-hamlet-state/junior/context/skill_prd_review.md` → `prd_review.md`

**Junior system prompts** at `junior/lib/gemini.ts:620, 640` — currently tell the model:
> read those files (system.md, glossary.md, skill_*.md, preferences.md) carefully

Update to:
> read those files (system.md, glossary.md, preferences.md, plus any other *.md skill files) carefully

**Mirror in hamlet-app**: `lib/prompt-registry.ts:352, 370` (defaults for the same prompts) — same wording change.

**Comments**: `junior/lib/gemini.ts:705`, `hamlet-app/lib/junior-context.ts:11` — update the inline doc.

**UI**: `JuniorContextView.tsx`
- Replace `name.startsWith('skill_')` (line 23) with `!PERSONA_FILES.has(name)` to classify into Skills section.
- Update create-modal placeholder (line 320): `skill_prd_review.md` → `prd_review.md`.

### Out of scope

- **Live invocation history** (which feature → which tool → when). Useful but a separate feature; would need Junior to log function-call events to a queryable store.
- **Editing tools from Hamlet**. Tools are code, requires deploy.
- **Per-feature tool gating**. Doesn't exist today; tools are global per turn.

## Components

### New

- `junior/app/api/tools/route.ts` — exports `tools` array as JSON
- `hamlet-app/app/api/junior-tools/route.ts` — proxies + caches Junior's tools endpoint

### Modified

- `hamlet-app/components/JuniorContextView.tsx` — add four-section grouping, Tools section, persona allowlist, modal placeholder
- `junior/lib/gemini.ts` — system prompt text (lines 620, 640), comment at 705
- `hamlet-app/lib/prompt-registry.ts` — system prompt defaults (lines 352, 370)
- `hamlet-app/lib/junior-context.ts` — doc comment at line 11

### One-time migrations

- Rename 5 GCS files (drop `skill_` prefix). Best done as a small script run once.

## Risks / open questions

1. **GCS rename ordering**: if Hamlet ships before Junior is redeployed, Junior's older system prompts still tell the model to look for `skill_*.md`, but the files have moved. Mitigation: rename files in GCS *after* Junior deploys with the new prompts. Document the ordering in the implementation plan.

2. **GCS overrides on the system prompts**: `prompt-registry.ts` defaults change won't affect runtime if there's a GCS override at `gs://tiktok-im-hamlet-state/hamlet/prompts.json`. Check for an override on `junior.system_prompt` and `junior.comment_system_prompt` before deploying; update or clear if present.

3. **Tools endpoint exposure**: `GET /api/tools` on Junior is read-only and returns no secrets, but should still gate on `Authorization: Bearer ${JUNIOR_CRON_SECRET}` to match Junior's existing internal-route convention. The Hamlet proxy stays internal.
