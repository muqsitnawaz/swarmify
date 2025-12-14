#!/bin/bash
set -e

cd "$(dirname "$0")/.."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "agent-spawner publish script"
echo "============================="
echo ""

# Check for uv
if ! command -v uv &> /dev/null; then
    echo -e "${RED}Error: uv is not installed${NC}"
    echo "Install with: curl -LsSf https://astral.sh/uv/install.sh | sh"
    exit 1
fi

# Get current version from pyproject.toml
CURRENT_VERSION=$(grep -m1 'version = ' pyproject.toml | cut -d'"' -f2)
echo "Current version: $CURRENT_VERSION"

# Check for version argument
if [ -n "$1" ]; then
    NEW_VERSION="$1"
else
    echo ""
    echo -e "${YELLOW}No version specified.${NC}"
    echo "Usage: ./scripts/publish.sh <version>"
    echo "Example: ./scripts/publish.sh 0.2.0"
    exit 1
fi

echo "New version: $NEW_VERSION"
echo ""

# Update version in pyproject.toml
sed -i '' "s/version = \"$CURRENT_VERSION\"/version = \"$NEW_VERSION\"/" pyproject.toml
echo "Updated pyproject.toml to version $NEW_VERSION"

# Run tests
echo ""
echo "Running tests..."
uv run pytest tests/ -v
echo -e "${GREEN}Tests passed${NC}"

# Clean previous builds
echo ""
echo "Cleaning previous builds..."
rm -rf dist/ build/ *.egg-info src/*.egg-info

# Build
echo ""
echo "Building package..."
uv build
echo -e "${GREEN}Build complete${NC}"

# Show what will be published
echo ""
echo "Built artifacts:"
ls -la dist/

# Confirm before publishing
echo ""
echo -e "${YELLOW}Ready to publish to PyPI${NC}"
read -p "Publish agent-spawner $NEW_VERSION to PyPI? [y/N] " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Publishing to PyPI..."
    uv publish
    echo ""
    echo -e "${GREEN}Published agent-spawner $NEW_VERSION to PyPI${NC}"
    echo ""
    echo "Install with:"
    echo "  uvx agent-spawner"
    echo "  pip install agent-spawner==$NEW_VERSION"
else
    echo "Publish cancelled."
    echo ""
    echo "To publish manually:"
    echo "  uv publish"
fi
