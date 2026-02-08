#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "Deploying swarmify-oauth worker..."
bunx wrangler deploy

echo "Deployed: https://swarmify-oauth.muqsitnawaz.workers.dev"
