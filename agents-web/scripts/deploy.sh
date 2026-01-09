#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "Building site..."
bun run build

echo "Deploying to Cloudflare Pages..."
bunx wrangler pages deploy out --project-name=swarmify

echo "Done! Site deployed to https://swarmify.dev"
