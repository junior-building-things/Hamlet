# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Critical: this is Next.js 16 (Turbopack, React 19)

This is NOT the Next.js you know from training. APIs, conventions, and file structure may all differ. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

## Commands

```bash
npm run dev      # Start dev server on :3000 (Turbopack)
npm run build    # Production build (uses Dockerfile in prod)
npm run lint     # ESLint
```

After pushing changes, **always deploy to Cloud Run**:

```bash
gcloud config set account thomas.oefverstroem@bytedance.com
cd /Users/bytedance/Documents/Personal/Coding/Hamlet
gcloud run deploy hamlet --source=. --project=tiktok-im --region=asia-southeast1
gcloud config set account oefverstroemt@gmail.com   # restore personal account
```

The Cloud Run service is `hamlet` in project `tiktok-im` (project number `416594255546`), reachable at `https://hamlet-416594255546.asia-southeast1.run.app`.

## High-level architecture

Hamlet is a PM dashboard for TikTok IM features. It pulls data from **Meego** (work item tracking) and **Lark** (chat / docs), enriches it via Gemini, and surfaces it in a Next.js UI plus a daily digest sent to a Lark group.

### State of truth

- **GCS bucket `gs://tiktok-im-hamlet-state/`** is the source of truth across browsers/devices and across the digest cron + UI:
  - `hamlet/features.json` — the full feature list with all enriched fields (status, version history, risk, links, team avatars, `manualEdits[]`, etc.)
  - `hamlet/deleted-ids.json` — blocklist of feature IDs confirmed deleted in Meego (filtered out of `fetchUserStories`)
  - `hamlet/prd-snapshots.json` — text snapshot of every tracked PRD (used by the daily PRD-change scan)
  - `digests/chat-risks.json` — digest pipeline state (per-feature risk entries, recent run timestamps, Junior chats cache, watchlist, the rotating Lark user refresh token)
- The browser **never** uses localStorage for feature data. The init flow loads from `/api/features/cache` and only that. Sync All explicitly writes the cache.
- `manualEdits[]` on a feature lists field keys (e.g. `libraUrl`, `figmaUrl`) that the user edited inline in the UI; **all sync paths must skip these fields when writing back**, otherwise edits get clobbered. Three places enforce this: `/api/meego/sync` (per-feature sync), `/api/meego/features?force=1` (Sync All cache replacement), and the frontend `pick()` helper.

### Feature discovery (3 sources, deduped)

`lib/meego.ts:fetchUserStories` unions:
1. `list_todo` MCP call — features with a pending action
2. MQL `__PM = current_login_user()` — features where the user is sole PM (Meego MQL has no `IN`/`INCLUDES` operator that works here, so co-PM features are missed)
3. **Junior chats cache** in GCS state — catches co-PM features that MQL drops (Junior is in those group chats)

Status fields: `MeegoFeature.overallStatusName` is the Chinese name; `OVERALL_STATUS_MAP` in `lib/meego.ts` maps to English display labels. The `list_todo` path returns *node-level* status (less accurate); `syncFeatureStatus` returns the *overall* status — always prefer the overall status when merging.

### Daily digest pipeline (`lib/digests.ts:runDailyDigests`)

Triggered by Cloud Scheduler `hamlet-daily-digest` (`0 10 * * 1-5 Asia/Singapore`) → `POST /api/digests/run`. Sequential steps:

1. **Step 0/0b**: load digest state, refresh Junior chats cache
2. **Step 1**: discover PM-owned features (3 sources above)
3. **Step 2**: fetch `get_workitem_brief` for each feature
4. **Step 2b**: merge into GCS feature cache; detect status transitions (e.g. → Line Review fires a `PRD Ready ✅` card)
5. **Step 2c**: PRD content scan — diff each PRD's text against `prd-snapshots.json`. If changed: Gemini summarizes, `appendPrdChangeLog()` adds a row to the PRD's "Change Log" table (auto-grants bot edit access via user token if `1770032` forbidden), update snapshot
6. **Step 2c.5** ⭐: send the PRD changes digest card to the PM group **before** Q&A scan — Q&A can time out and would skip later sends
7. **Step 3+**: filter to in-dev features, resolve deadlines/chats/Rio token
8. **Step 4**: risk eval (Gemini chat risk + version/launch-date delay detection via `get_workitem_op_record`)
9. **Step 6**: Q&A scan over Junior chats — detect @mentions of owner with no reply
10. **Step 7/8**: send risk digest + unanswered Q&A digest (both via Rio token, Rio is a separate Lark app)

The 10-minute `maxDuration` on `/api/digests/run` is the binding constraint. **Anything that must always send goes before Q&A scan.**

### Junior bot integration

Junior is a separate Cloud Run service (`junior` in `tiktok-im`) with its own repo. The two apps share `LARK_APP_ID = cli_a911076bd5f8dbde` (Junior IS the main Lark app for Hamlet). Junior's Cloud Run env has `LARK_BOT_OPEN_ID` which Hamlet also needs (set on Hamlet too).

**Card callback URL** for Junior's Lark app:
`https://hamlet-416594255546.asia-southeast1.run.app/api/lark/card-action`

Configured in the Lark app's Events & Callbacks → Card Callback. `LARK_ENCRYPT_KEY` env var on Hamlet is required because the Lark app has encryption enabled.

### Card-action flow

PRD changes digest cards include a per-PRD **"Send to Feature Group"** button. Clicking it POSTs an encrypted payload to `/api/lark/card-action`, which:
1. Decrypts via `LARK_ENCRYPT_KEY` (AES-256-CBC)
2. Verifies `url_verification` challenge / acks unknown actions
3. For `send_prd_change_to_group`: auto-adds bot to the chat (via user token fallback if bot can't self-join — error 232011), then sends a card with the PRD update

### Token strategy

- **Tenant token** (Hamlet's `getAccessToken` / `getLarkBotToken`) — most operations
- **User token** (PM's, refreshable via `larkUserRefreshToken` in GCS state) — needed for: Drive search, ABreport doc reads, granting bot access to PRDs the bot doesn't own, adding bot to chats it isn't in
- **Rio/Mia tokens** (`getAgentToken` in `lib/agents.ts`) — separate Lark apps used for risk + unanswered digests
- Token rotation: the digest pipeline rotates the user refresh token on every run and writes to `state.larkUserRefreshToken`; the sync route reads from in-memory cache → session cookie → GCS state in that order

### Inline editing (UI)

`FeatureListItem` cells for **name** and **notes** are editable; `LinkIcons` tooltips have edit + copy buttons. On edit:
1. Optimistic local state update via `setFeatures`
2. Adds the field key to `manualEdits[]`
3. POST `/api/meego/update` which writes to Meego (for Meego-backed fields: `name`, `prd`, `priority`, `figmaUrl`) **and** GCS cache, plus renames the PRD doc title via Lark API when name changes
4. Protected fields (`prd`, `figmaUrl`, `abReportUrl`, `libraUrl`, `complianceUrl`) are skipped on subsequent syncs

Tooltips render via `createPortal` to `document.body` to escape the scrollable container's `overflow:auto` clipping.

### Light/dark theme

Layout's inline script forces `data-theme="light"` on every page load (ignores localStorage). ThemeToggle still works for the session. CSS variables in `globals.css`. Tooltips use `var(--card)` (white in light) instead of `var(--background)` (off-white).

## Authentication

Lark OIDC. Cookie session via `lib/session.ts` (jose). Middleware (`middleware.ts`) enforces auth except for `/login`, `/api/auth/`, `/api/agents/webhook`, `/api/digests/run`, `/api/meego/ai-node`, `/api/lark/card-action`.
