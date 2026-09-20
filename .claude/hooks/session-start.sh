#!/bin/bash
set -euo pipefail

# Only needed for Claude Code on the web — local sessions already have a
# dev environment set up.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

echo '{"async": true, "asyncTimeout": 300000}'

cd "$CLAUDE_PROJECT_DIR"

npm install --no-audit --no-fund

# Lets `npm run dev` and unit tests resolve the amplify_outputs.json import
# in src/main.tsx without needing a real backend deploy or a build first.
node scripts/setup-amplify-outputs.mjs
