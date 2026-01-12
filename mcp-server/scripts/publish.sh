#!/bin/bash
# Build and publish the Swarm MCP server package to npm

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SWARM_DIR="$(dirname "$SCRIPT_DIR")"

cd "$SWARM_DIR"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 x.y.z"
  exit 1
fi

VERSION="$1"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid version: $VERSION"
  echo "Expected format: x.y.z"
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required but was not found in PATH"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found in PATH"
  exit 1
fi

# Ensure dependencies are installed
bun install

# Build TypeScript output
rm -rf dist
bun run build

# Bump package version without git tagging
npm version "$VERSION" --no-git-tag-version

# Verify npm auth before publishing
if ! npm whoami >/dev/null 2>&1; then
  echo "npm login required before publishing"
  exit 1
fi

npm publish --access public

echo "Publish complete"
