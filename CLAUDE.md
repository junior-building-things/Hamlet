# CLAUDE.md

Project-specific instructions for Claude when working in this repo.

Hamlet is a Next.js web app for TikTok PMs to track features, sync with Meego, chat with **Junior** (Lark bot), and run digest crons. Related services: **Junior** (Lark assistant, separate deploy), **Rio** / **Mia** (Lark agents for merge checks and other automations).

## Stack

- **Next.js 16** (App Router), React 19, TypeScript, Tailwind 4
- **LLM calls** all go through [lib/llm.ts](lib/llm.ts) `generateText()`, which shells out to the `claude` CLI (`claude -p`). There is no API key and no second provider — Gemini was removed. Auth is the user's Claude subscription: an interactive login locally, `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) in the container. Never set `ANTHROPIC_API_KEY` — it would switch the CLI to per-token API billing. Model comes from the prompt registry (`opts.model`) → `CLAUDE_MODEL` → `claude-sonnet-5`; non-`claude-*` names are ignored so stale `gemini-*` overrides in GCS fall back instead of failing. Use `claude-haiku-4-5` for real-time request paths, `claude-sonnet-5` for batch. `@anthropic-ai/sdk` is a dependency but currently unused. **Junior is a separate service and still runs on Gemini** — the `junior.*` prompt-registry entries are stored by Hamlet but executed there.
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
| [tools/](tools/) | Deterministic Python scripts invoked by workflows (WAT framework) |
| [workflows/](workflows/) | Markdown SOPs that define automation processes for the WAT framework |

Client routes use `history.pushState` (e.g. `/projects`, `/chat`); rewrites in [next.config.ts](next.config.ts) map some paths to `/`.

## Services and boundaries

- **Hamlet (this repo)** — UI, feature cache, digest crons, prompt overrides UI, proxies to Junior (`JUNIOR_URL` + `JUNIOR_CRON_SECRET`).
- **Junior** — Lark bot, tool calling, PRD flows; deployed separately (e.g. Cloud Run). Hamlet must not assume Junior code lives here except via HTTP APIs.
- **Rio / Mia** — Lark app credentials in [lib/agents.ts](lib/agents.ts); webhooks at [app/api/agents/webhook/route.ts](app/api/agents/webhook/route.ts).

When adding prompts: register in [lib/prompt-registry.ts](lib/prompt-registry.ts), call `getPrompt(id, default)` from [lib/prompts.ts](lib/prompts.ts) at runtime. Overrides live in GCS `hamlet/prompts.json` (30s in-memory cache).

## State and sync

- Feature list and detail: Meego sync → GCS cache ([lib/feature-cache.ts](lib/feature-cache.ts), [app/api/meego/sync/route.ts](app/api/meego/sync/route.ts)).
- Digests / risk: [lib/digests.ts](lib/digests.ts), cron triggers under [app/api/digests/](app/api/digests/) and [app/api/crons/](app/api/crons/). The batch (non-interactive) pipeline does **not** run behind an HTTP route: a full pass takes 10–26 min, past Cloud Scheduler's 30-min HTTP ceiling and the routes' 600s `maxDuration`. It runs as the **`hamlet-digests` Cloud Run Job** ([Dockerfile.job](Dockerfile.job), entrypoint [tools/run-digests.ts](tools/run-digests.ts), 1h task timeout, `max-retries 0` because a retry could re-post cards). Two Cloud Scheduler entries drive it, both calling the Run Admin API `jobs:run`: `hamlet-daily-digest` (9:30 SGT weekdays, mode `all`) and `hamlet-digests-trigger` (every 10 min, mode `watch-trigger`).
  - These crons are flagged `runsInJob` in [lib/cron-registry.ts](lib/cron-registry.ts). Their **per-section** Scheduler jobs stay PAUSED, so the Crons tab reads pause/last-run from GCS state (`cronPaused` / `cronLastRun`), not Cloud Scheduler. "Trigger once" writes `cronTriggerRequests`, which `watch-trigger` consumes on its next poll. Pausing a master (`hamlet-daily-digest` / `refresh-feature-cache`) skips the whole pass; per-section `digest.*` pauses skip just that card.
  - The Job needs the same env as the service; CI mirrors it automatically via `--env-vars-file` (see [deploy.yml](.github/workflows/deploy.yml)) so the two can't drift — don't hand-maintain a second copy. Note Cloud Run Jobs set `CLOUD_RUN_JOB`, **not** `K_SERVICE`; [lib/gcs-state.ts](lib/gcs-state.ts) checks both before falling back to gcloud ADC.
  - [tools/launchd/](tools/launchd/) is the retired Mac LaunchAgent setup this replaced; the installed plists are renamed `.disabled`. Don't re-enable them alongside the Job — both would run and double-post cards.
- Junior context files: `gs://tiktok-im-hamlet-state/junior/context/<name>.md`.
- Auth: Lark OAuth + session cookie ([lib/session.ts](lib/session.ts), [app/api/auth/](app/api/auth/)). Access limited to configured users.

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
Behavioral guidelines to reduce common LLM coding mistakes. Merge with the project-specific instructions above as needed.

**Tradeoff:** these guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First
Minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes
Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports / variables / functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution
Define success criteria. Loop until verified.

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
