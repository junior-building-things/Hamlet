#!/bin/bash
# Wrapper invoked by ~/Library/LaunchAgents/com.bytedance.lark-download.plist.
# Sets a PATH that includes homebrew (launchd inherits a minimal PATH), cd's
# into the Hamlet repo so .env.local loads, and runs the download script.
#
# Skip-if-exists is built into the script — re-runs only fetch new docs.

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

# docx only — legacy "doc" type isn't readable by the docx blocks endpoint
# we use (returns code=99991668), and we don't want 56 noisy failures every
# morning in the cron log.
export FILE_TYPES="docx"

cd /Users/bytedance/Documents/Work/Coding/Hamlet

echo "=== $(date '+%Y-%m-%d %H:%M:%S') lark-download starting ==="
exec npx --yes tsx tools/download-lark-docs.ts
