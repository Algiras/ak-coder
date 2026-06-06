#!/usr/bin/env bash
# Publish @algiras/ak-coder to npm. Requires: bun, npm auth (NPM_TOKEN or bunx npm login).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/apps/cli"
VERSION="$(node -pe "require('$CLI/package.json').version")"

echo "→ Publishing @algiras/ak-coder@${VERSION}"

cd "$ROOT"
bun install --frozen-lockfile
bun run test:coverage:check

cp "$ROOT/README.md" "$CLI/README.md"
cd "$CLI"
bun run build
npm publish --dry-run --access public 2>/dev/null || true
npm publish --access public

echo "✓ Published https://www.npmjs.com/package/@algiras/ak-coder"
