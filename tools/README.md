# Tools

Deterministic Python scripts invoked by workflows.

## Conventions

- Each tool is an independent `*.py` script — no shared framework code beyond what the script imports directly.
- Tools should be runnable standalone (e.g. `python tools/my_tool.py`).
- All secrets and credentials come from environment variables loaded from `.env`. **Never hardcode secrets.** See `../.env.example` for the expected variables.
- Print structured output (JSON to stdout) when the result will be consumed by the Agent or another tool.
- Exit non-zero on failure with a clear stderr message so the Agent can self-heal.

## Adding a new tool

1. Check this directory for an existing tool that already does the job.
2. If none exists, create `tools/<verb>_<object>.py` (e.g. `fetch_meego_items.py`).
3. Document the tool's inputs / outputs in the workflow that calls it.
