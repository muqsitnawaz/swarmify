#!/bin/bash

set -e

# Check if version argument is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <version>"
    echo "Example: $0 1.0.0"
    exit 1
fi

VERSION=$1

# Validate version format (basic check)
if ! [[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: Version must be in format X.Y.Z (e.g., 1.0.0)"
    exit 1
fi

echo "Building agents-ext v${VERSION}..."

# Get the project root directory
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"
DIST_DIR="$PROJECT_ROOT/dist"

# Update version in package.json
echo "Updating version to ${VERSION}..."
node -e "const fs=require('fs');const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));pkg.version='${VERSION}';fs.writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n')"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    bun install
fi

# Compile TypeScript
echo "Compiling TypeScript..."
bun run compile

# Install vsce if not available
if ! command -v vsce &> /dev/null; then
    echo "Installing vsce..."
    bun add -g @vscode/vsce
fi

# Package extension
echo "Creating dist directory..."
mkdir -p "$DIST_DIR"

echo "Packaging extension..."
vsce package --out "$DIST_DIR/agents-ext-${VERSION}.vsix"

echo "Build complete: $DIST_DIR/agents-ext-${VERSION}.vsix"
