#!/bin/bash
# Wrapper invoked by ~/Library/LaunchAgents/com.bytedance.lark-download.plist.
# Sets a PATH (launchd inherits a minimal one) that includes homebrew AND the
# nvm bin — the latter is where `lark-cli` lives, which the download script
# shells out to for all Lark API calls (auth via lark-cli's user session).
# cd's into the Hamlet repo so .env.local loads (Lark credentials etc.).
#
# Skip-if-exists is built into the script — re-runs only fetch new docs.
#
# NOTE: the installed copy lives at
#   ~/Library/Application Support/lark-download/run.sh
# This file in the repo is the canonical source — keep the two in sync.

set -euo pipefail

export PATH="/Users/bytedance/.nvm/versions/node/v22.22.3/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

# docx only — legacy "doc" type isn't readable by the docx blocks endpoint
# we use (returns code=99991668), and we don't want 56 noisy failures every
# morning in the cron log.
export FILE_TYPES="docx"

cd /Users/bytedance/Documents/Work/Coding/pm-automation/hamlet

echo "=== $(date '+%Y-%m-%d %H:%M:%S') lark-download starting ==="
exec npx --yes tsx tools/download-lark-docs.ts
