#!/usr/bin/env bash
# Publish @algiras/ak-coder to npm. Reads NPM_TOKEN from .env or NODE_AUTH_TOKEN.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/apps/cli"
VERSION="$(node -pe "require('$CLI/package.json').version")"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

TOKEN="${NODE_AUTH_TOKEN:-${NPM_TOKEN:-}}"
if [[ -z "$TOKEN" ]]; then
  echo "error: set NPM_TOKEN in .env or NODE_AUTH_TOKEN in the environment" >&2
  exit 1
fi

echo "→ Publishing @algiras/ak-coder@${VERSION} as $(npm whoami --userconfig <(printf '//registry.npmjs.org/:_authToken=%s\n' "$TOKEN") 2>/dev/null || echo 'unknown')"

cd "$ROOT"
bun install --frozen-lockfile
bun run test:coverage:check

cp "$ROOT/README.md" "$CLI/README.md"
cd "$CLI"
bun run build

NPMRC="$(mktemp)"
trap 'rm -f "$NPMRC"' EXIT
printf '//registry.npmjs.org/:_authToken=%s\n' "$TOKEN" > "$NPMRC"
npm publish --userconfig "$NPMRC" --access public

echo "✓ Published https://www.npmjs.com/package/@algiras/ak-coder"
