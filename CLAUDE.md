# CLAUDE.md

Project-specific instructions for Claude when working in this repo.

Hamlet is a Next.js web app for TikTok PMs to track features, sync with Meego, chat with **Junior** (Lark bot), and run digest crons. Related services: **Junior** (Lark assistant, separate deploy), **Rio** / **Mia** (Lark agents for merge checks and other automations).

## Stack

- **Next.js 16** (App Router), React 19, TypeScript, Tailwind 4
- **LLM calls** all go through [lib/llm.ts](lib/llm.ts) `generateText()`, which shells out to the `claude` CLI (`claude -p`). There is no API key and no second provider — Gemini was removed. Auth is the user's Claude subscription: an interactive login locally, `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) in the container. Never set `ANTHROPIC_API_KEY` — it would switch the CLI to per-token API billing. Model comes from the prompt registry (`opts.model`) → `CLAUDE_MODEL` → `claude-sonnet-5`; non-`claude-*` names are ignored so stale `gemini-*` overrides in GCS fall back instead of failing (that guard applies to `hamlet.*` prompts only — see `getPromptModel`). Most Hamlet prompts default to `claude-sonnet-5`; the exceptions are the Chat tab, a single conversational call ([app/api/chat/route.ts](app/api/chat/route.ts)) that reuses Junior's `junior.system_prompt` + its GCS context files and runs on `claude-opus-4-8` at `high` effort (`opts.effort`), `hamlet.prd_scaffold` on `claude-opus-5`, and `hamlet.prd_research_queries` on `claude-haiku-4-5`. The old intent-classify → [app/api/chat/execute/route.ts](app/api/chat/execute/route.ts) pipeline is retired; that route is unused. `@anthropic-ai/sdk` is a dependency but currently unused. **Junior is a separate service and still runs on Gemini** — the `junior.*` prompt-registry entries are stored by Hamlet but executed there.
- **Lark** Open APIs (`LARK_APP_ID`, `LARK_APP_SECRET`, `LARK_BOT_OPEN_ID`)
- **Meego** work items (`MEEGO_USER_TOKEN`, `MEEGO_PROJECT_KEY`)
- **GCS** JSON state at `gs://tiktok-im-hamlet-state` (no `@google-cloud/storage` — REST + metadata token in [lib/gcs-state.ts](lib/gcs-state.ts))
- **Docker** standalone build (`output: 'standalone'` in [next.config.ts](next.config.ts)) for the service; a second image ([Dockerfile.job](Dockerfile.job)) carries the TS sources + `tsx` for the digest Cloud Run Job. Both install the `claude` CLI.

### Next.js version warning

This is **not** stock Next.js from training data. Before changing routing, data fetching, or server APIs, read the guide in `node_modules/next/dist/docs/` and heed deprecation notices.

## Layout

| Area | Purpose |
|------|---------|
| [app/[[...slug]]/page.tsx](app/[[...slug]]/page.tsx) | SPA shell: Product Features, Vibe Projects, Todos, Chat, Roles, Prompts, Junior Context, Crons |
| [app/api/](app/api/) | Route handlers (Meego sync, digests, chat, crons, admin, Lark webhooks) |
| [lib/](lib/) | Domain logic: `meego.ts`, `lark.ts`, `digests.ts`, `prompts.ts`, `gcs-state.ts`, `agents.ts`, … |
| [components/](components/) | UI views (`ProjectView`, `ChatView`, `JuniorContextView`, …) |
| [lib/prompt-registry.ts](lib/prompt-registry.ts) | All prompt IDs + defaults for Hamlet, Junior, Rio, Mia |
| [lib/junior-context.ts](lib/junior-context.ts) | GCS-backed markdown Junior loads at chat time (`junior/context/*.md`) |
| [lib/prd-scaffold.ts](lib/prd-scaffold.ts) | New-PRD drafting: Lark doc research + the scaffold the create-PRD route fills in |
| [tools/](tools/) | Deterministic Python scripts invoked by workflows (WAT framework) |
| [workflows/](workflows/) | Markdown SOPs that define automation processes for the WAT framework |

Client routes use `history.pushState` (e.g. `/projects`, `/chat`); rewrites in [next.config.ts](next.config.ts) map some paths to `/`.

## Services and boundaries

- **Hamlet (this repo)** — UI, feature cache, digest crons, prompt overrides UI, proxies to Junior (`JUNIOR_URL` + `JUNIOR_CRON_SECRET`).
- **Junior** — Lark bot, tool calling, PRD flows; deployed separately (e.g. Cloud Run). Hamlet must not assume Junior code lives here except via HTTP APIs. Junior calls Hamlet's `/api/cards/edit-section` with `Authorization: Bearer $AGENT_RUN_SECRET`, so that secret must hold the same value on both services.
- **Rio / Mia** — Lark app credentials in [lib/agents.ts](lib/agents.ts); webhooks at [app/api/agents/webhook/route.ts](app/api/agents/webhook/route.ts).

Creating a feature is two calls, so the modal doesn't wait on the PRD: [app/api/meego/create](app/api/meego/create/route.ts) makes the Meego story (409 if one with the same name appeared in the last 10 min), then the client calls [app/api/meego/create-prd](app/api/meego/create-prd/route.ts), which researches related Lark docs, copies the template, fills the tables, links Meego + the auto-created legal ticket, and opens org link sharing. While that runs the feature carries client-only `prdPending` / `prdFailed` flags; the retry chip re-runs it via a `hamlet:retry-prd` window event handled in [app/[[...slug]]/page.tsx](app/[[...slug]]/page.tsx). The browser path isn't guaranteed (dropped connections, tabs on an old bundle), so the create route also records the request in `state.pendingPrds`, and the digest Job's `watch-trigger` poll finishes any still pending after 8 min via [lib/prd-create.ts](lib/prd-create.ts), which is idempotent. It also restores the Quarterly Cycle: a Meego automation resets 季度规划 to the current quarter ~8s after every new story.

Proactive updates: a per-feature switch (New Feature modal, the Product Features list next to Changelog, feature drawer) stored in `state.proactiveWatch` via [app/api/proactive](app/api/proactive/route.ts). The Job's `watch-trigger` poll runs [lib/proactive.ts](lib/proactive.ts), which diffs each watched feature's status, target version and risk level (from the digest, via the feature cache) against its snapshot, has `hamlet.proactive_chat` judge new group-chat messages, and DMs Thomas from the Junior bot. The first check after switching on only records a baseline. Read feature groups with the main bot token — Rio isn't a member of most of them, and `readChatMessages` returns `[]` rather than erroring when the bot isn't in the chat.

When adding prompts: register in [lib/prompt-registry.ts](lib/prompt-registry.ts), call `getPrompt(id, default)` from [lib/prompts.ts](lib/prompts.ts) at runtime. Overrides live in GCS `hamlet/prompts.json` (30s in-memory cache).

## State and sync

- Feature data: **Meego is the source of truth, read live.** [lib/live-features.ts](lib/live-features.ts) merges live Meego (list via `getLiveFeatureList`, full detail via `getLiveFeature`) with Hamlet's stored fields; anything that decides or answers from status / node / roles / version reads through it. `hamlet/features.json` ([lib/feature-cache.ts](lib/feature-cache.ts)) holds only what Meego doesn't have (`HAMLET_FIELDS`: notes, toggles, hand-edited links, Libra / AB / package / chat lookups, risk and version-slip history) — never read Meego fields from it. Junior reads features through `GET /api/admin/features[/<id>]` (Bearer `AGENT_RUN_SECRET`). The page paints the browser's last-seen list (localStorage) and then refreshes from Meego on every open (`meegoOnly` detail sync); Sync All and the 2h timer also redo the slow lookups. The digest remembers only each feature's last-seen status ([lib/last-statuses.ts](lib/last-statuses.ts), `digests/last-statuses.json`, written every run) to spot transitions like → Line Review; its later steps fetch features live.
- Digests / risk: [lib/digests.ts](lib/digests.ts), cron triggers under [app/api/digests/](app/api/digests/) and [app/api/crons/](app/api/crons/). The batch (non-interactive) pipeline does **not** run behind an HTTP route: a full pass takes 10–26 min, past Cloud Scheduler's 30-min HTTP ceiling and the routes' 600s `maxDuration`. It runs as the **`hamlet-digests` Cloud Run Job** ([Dockerfile.job](Dockerfile.job), entrypoint [tools/run-digests.ts](tools/run-digests.ts), 1h task timeout, `max-retries 0` because a retry could re-post cards). Two Cloud Scheduler entries drive it, both calling the Run Admin API `jobs:run`: `hamlet-daily-digest` (9:30 SGT weekdays, mode `all`) and `hamlet-digests-trigger` (every 10 min, mode `watch-trigger`).
  - **The digest sends no cards** (`DIGEST_CARDS_ENABLED` in [lib/digests.ts](lib/digests.ts)); Thomas relies on per-feature Proactive updates instead. The pass still records risk, version slips, PRD change-log entries and last-seen statuses. Its crons are flagged `runsInJob` in [lib/cron-registry.ts](lib/cron-registry.ts), so the Crons tab reads pause/last-run from GCS state (`cronPaused` / `cronLastRun`), not Cloud Scheduler. "Trigger once" writes `cronTriggerRequests`, which `watch-trigger` consumes on its next poll. Pausing the master (`hamlet-daily-digest`) skips the whole pass.
  - The Job needs the same env as the service; CI mirrors it automatically via `--env-vars-file` (see [deploy.yml](.github/workflows/deploy.yml)) so the two can't drift — don't hand-maintain a second copy. Note Cloud Run Jobs set `CLOUD_RUN_JOB`, **not** `K_SERVICE`; [lib/gcs-state.ts](lib/gcs-state.ts) checks both before falling back to gcloud ADC.
  - [tools/launchd/](tools/launchd/) is the retired Mac LaunchAgent setup this replaced; the installed plists are renamed `.disabled`. Don't re-enable them alongside the Job — both would run and double-post cards.
- Junior context files: `gs://tiktok-im-hamlet-state/junior/context/<name>.md`.
- Auth: Lark OAuth + session cookie ([lib/session.ts](lib/session.ts), [app/api/auth/](app/api/auth/)). Access limited to configured users. Anything in [middleware.ts](middleware.ts)'s `PUBLIC` list bypasses that check, so **those routes must authenticate themselves and fail closed** — Lark callbacks by rejecting unencrypted payloads, the Meego AI node by requiring its `source_plugin_id`, service-to-service calls by bearer token or session. Never log a token.
- GCS state writes: `updateDigestState()` ([lib/digest-state.ts](lib/digest-state.ts)) applies a narrow change under a generation precondition and is the default for request-path writes, since a digest pass holds a whole-file snapshot for 10-26 minutes. `saveDigestState()` overwrites the entire document — pass-level saves only.
- Thomas's Lark user token: `getLarkUserToken()` ([lib/lark.ts](lib/lark.ts)) is the **only** thing that refreshes it — it caches the access token in GCS state (seeded at login) and persists each rotated refresh token. Never refresh anywhere else: replaying a used refresh token fails and can revoke the login. Needed for anything the bot app has no scope for — doc search and link-sharing settings. Lark keeps one user login per app, so nothing else may log Thomas into this app (`cli_a911076bd5f8dbde`) — lark-cli has its own app for that. When the login does die, those steps degrade with a warning and he re-logs into Hamlet.

## Commands

```bash
npm run dev      # local UI (needs env for real API calls)
npm run build    # production build
npm run lint     # eslint
```

Production runs the Docker image (`node server.js` on port 8080). GCS reads/writes need Cloud Run metadata credentials locally unless you mock or skip those paths.

### Verification

- `npm run lint` after TS changes.
- For API/route changes, exercise the relevant `app/api/...` handler or UI flow if env is available; do not claim Meego/Lark integration works without a real or mocked call when the change depends on it.

## Auto-commit and push

After completing any code change, automatically stage, commit, and push to GitHub without asking.

- Stage only files that you changed (specific paths — never `git add -A` / `git add .`).
- Write a concise commit message in the style of recent commits (`git log` for reference).
- Push to the current branch's upstream.
- If `git push` fails (no upstream, rejected, auth), report the error and stop — don't force-push or rewrite history without an explicit ask.
- This overrides the default "ask before committing / pushing" behavior for this repo only.

## Related docs

- [docs/superpowers/specs/](docs/superpowers/specs/) — design specs (e.g. Junior tools in Context tab)
- Workspace `memory.md` — owner preferences (not duplicated here)

## Keeping this file current

Update CLAUDE.md as part of the same change whenever you:

- Add, rename, or remove a top-level directory (e.g. `lib/`, `app/api/<area>/`, `tools/`, `workflows/`).
- Add or remove a major external service / SDK / env var the app depends on.
- Change a service boundary (what Hamlet owns vs. what Junior / Rio / Mia own).
- Change how state is persisted (GCS paths, cache shape, auth model).
- Change build, run, or verification commands.
- Establish a new convention worth telling the next session about (a new pattern, a new "don't do X here").

Rules:

- Treat this as a surgical edit — touch only the lines that became wrong. Don't rewrite untouched sections.
- A change that doesn't affect any of the above doesn't need a CLAUDE.md edit. Don't churn this file.

---

## Behavioral Guardrails

The general working rules — think before coding, simplicity first, surgical changes, goal-driven
execution — live in `~/.claude/CLAUDE.md` and apply here. They bias toward caution over speed; for
trivial tasks, use judgment. Everything above this line is what's specific to Hamlet.
