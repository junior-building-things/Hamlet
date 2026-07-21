#!/bin/bash
# Wrapper invoked by the com.bytedance.hamlet-digests LaunchAgent.
# Mirrors the lark-download wrapper: launchd runs with a minimal PATH and
# environment, so we set PATH (incl. gcloud for local GCS auth) and cd into
# the canonical Hamlet checkout where .env.local lives.
#
# Install: copy this to a stable location and reference it from the plist,
# e.g. ~/Library/Application Support/hamlet-digests/run.sh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/google-cloud-sdk/bin"
cd /Users/bytedance/Documents/Work/Coding/pm-automation/hamlet
MODE="${1:-all}"
echo "=== $(date '+%Y-%m-%d %H:%M:%S') hamlet-digests ($MODE) starting ==="
exec npx --yes tsx tools/run-digests.ts "$MODE"
