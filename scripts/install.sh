#!/bin/bash

set -e

# Check if version argument is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <version>"
    echo "Example: $0 1.0.0"
    exit 1
fi

VERSION=$1

# Get the project root directory
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# Build the extension
echo "Building extension..."
bash scripts/build.sh "$VERSION"

# Install the extension
VSIX_FILE="cursor-agents-${VERSION}.vsix"

if [ ! -f "$VSIX_FILE" ]; then
    echo "Error: ${VSIX_FILE} not found"
    exit 1
fi

echo "Installing extension..."
cursor --install-extension "$VSIX_FILE" --force

echo "Extension installed successfully!"
echo "Restart VS Code to activate the extension."
