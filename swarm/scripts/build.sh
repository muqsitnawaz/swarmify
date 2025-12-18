#!/bin/bash
# Build and install the Swarm MCP server

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SWARM_DIR="$(dirname "$SCRIPT_DIR")"

echo "Building Swarm MCP server..."
cd "$SWARM_DIR"

# Install dependencies
bun install

# Build TypeScript
bun run build

echo "Build complete: $SWARM_DIR/dist/"
echo ""
echo "To use this MCP server, add to your Claude Code config:"
echo "  command: bun"
echo "  args: [\"run\", \"$SWARM_DIR/dist/server.js\"]"
