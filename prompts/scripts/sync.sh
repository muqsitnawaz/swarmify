#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Paths
CLAUDE_SYSTEM="$HOME/.claude/commands"
CLAUDE_REPO="$REPO_DIR/claude/commands"
CODEX_SYSTEM="$HOME/.codex/prompts"
CODEX_REPO="$REPO_DIR/codex/prompts"
CURSOR_SYSTEM="$HOME/.cursor/commands"
CURSOR_REPO="$REPO_DIR/cursor/commands"
GEMINI_SYSTEM="$HOME/.gemini/commands"
GEMINI_REPO="$REPO_DIR/gemini/commands"

usage() {
    echo "Usage: $0 <command> [--confirm]"
    echo ""
    echo "Commands:"
    echo "  status    Show sync status and diffs between repo and system"
    echo "  pull      Pull prompts from system (~/.claude, ~/.codex, ~/.cursor, ~/.gemini) to repo"
    echo "  push      Push prompts from repo to system (~/.claude, ~/.codex, ~/.cursor, ~/.gemini)"
    echo ""
    echo "Options:"
    echo "  --confirm  Actually execute the sync (default is dry-run)"
    echo ""
    echo "Examples:"
    echo "  $0 status           # Show what's different"
    echo "  $0 pull             # Dry-run pull from system"
    echo "  $0 pull --confirm   # Actually pull from system"
    echo "  $0 push --confirm   # Actually push to system"
    exit 1
}

show_diff() {
    local file1="$1"
    local file2="$2"
    local name="$3"

    if [[ ! -f "$file1" ]] && [[ ! -f "$file2" ]]; then
        return
    fi

    if [[ ! -f "$file1" ]]; then
        echo -e "  ${GREEN}+ $name${NC} (only in system)"
        return
    fi

    if [[ ! -f "$file2" ]]; then
        echo -e "  ${RED}- $name${NC} (only in repo)"
        return
    fi

    if ! diff -q "$file1" "$file2" > /dev/null 2>&1; then
        echo -e "  ${YELLOW}~ $name${NC} (modified)"
        diff --color=always -u "$file2" "$file1" 2>/dev/null | head -20 | sed 's/^/    /'
        local lines=$(diff -u "$file2" "$file1" 2>/dev/null | wc -l)
        if [[ $lines -gt 20 ]]; then
            echo -e "    ${BLUE}... ($((lines - 20)) more lines)${NC}"
        fi
    fi
}

status_section() {
    local system_dir="$1"
    local repo_dir="$2"
    local name="$3"
    local ext="$4"

    echo -e "\n${BLUE}=== $name ===${NC}"
    echo -e "System: $system_dir"
    echo -e "Repo:   $repo_dir"
    echo ""

    if [[ ! -d "$system_dir" ]]; then
        echo -e "  ${RED}System directory does not exist${NC}"
        return
    fi

    if [[ ! -d "$repo_dir" ]]; then
        echo -e "  ${RED}Repo directory does not exist${NC}"
        return
    fi

    local has_diff=false

    # Get all files from both directories
    local all_files
    all_files=$( (cd "$system_dir" && ls *.$ext 2>/dev/null || true; cd "$repo_dir" && ls *.$ext 2>/dev/null || true) | sort -u )

    for file in $all_files; do
        local sys_file="$system_dir/$file"
        local repo_file="$repo_dir/$file"

        if [[ -f "$sys_file" ]] && [[ -f "$repo_file" ]]; then
            if ! diff -q "$sys_file" "$repo_file" > /dev/null 2>&1; then
                has_diff=true
                show_diff "$sys_file" "$repo_file" "$file"
            fi
        elif [[ -f "$sys_file" ]]; then
            has_diff=true
            echo -e "  ${GREEN}+ $file${NC} (only in system)"
        elif [[ -f "$repo_file" ]]; then
            has_diff=true
            echo -e "  ${RED}- $file${NC} (only in repo)"
        fi
    done

    if [[ "$has_diff" == "false" ]]; then
        echo -e "  ${GREEN}In sync${NC}"
    fi
}

cmd_status() {
    echo -e "${BLUE}Sync Status${NC}"
    status_section "$CLAUDE_SYSTEM" "$CLAUDE_REPO" "Claude Commands" "md"
    status_section "$CODEX_SYSTEM" "$CODEX_REPO" "Codex Prompts" "md"
    status_section "$CURSOR_SYSTEM" "$CURSOR_REPO" "Cursor Commands" "md"
    status_section "$GEMINI_SYSTEM" "$GEMINI_REPO" "Gemini Commands" "toml"
    echo ""
}

sync_files() {
    local src_dir="$1"
    local dst_dir="$2"
    local ext="$3"
    local dry_run="$4"
    local direction="$5"

    if [[ ! -d "$src_dir" ]]; then
        echo -e "  ${RED}Source directory does not exist: $src_dir${NC}"
        return
    fi

    mkdir -p "$dst_dir"

    for file in "$src_dir"/*.$ext; do
        [[ -f "$file" ]] || continue
        local basename=$(basename "$file")
        local dst_file="$dst_dir/$basename"

        if [[ ! -f "$dst_file" ]] || ! diff -q "$file" "$dst_file" > /dev/null 2>&1; then
            if [[ "$dry_run" == "true" ]]; then
                if [[ ! -f "$dst_file" ]]; then
                    echo -e "  ${GREEN}[would create]${NC} $basename"
                else
                    echo -e "  ${YELLOW}[would update]${NC} $basename"
                fi
            else
                cp "$file" "$dst_file"
                if [[ ! -f "$dst_file" ]]; then
                    echo -e "  ${GREEN}[created]${NC} $basename"
                else
                    echo -e "  ${YELLOW}[updated]${NC} $basename"
                fi
            fi
        fi
    done
}

cmd_pull() {
    local dry_run="$1"

    if [[ "$dry_run" == "true" ]]; then
        echo -e "${YELLOW}DRY RUN - use --confirm to actually pull${NC}\n"
    else
        echo -e "${GREEN}Pulling from system to repo...${NC}\n"
    fi

    echo -e "${BLUE}Claude Commands${NC}"
    sync_files "$CLAUDE_SYSTEM" "$CLAUDE_REPO" "md" "$dry_run" "pull"

    echo -e "\n${BLUE}Codex Prompts${NC}"
    sync_files "$CODEX_SYSTEM" "$CODEX_REPO" "md" "$dry_run" "pull"

    echo -e "\n${BLUE}Cursor Commands${NC}"
    sync_files "$CURSOR_SYSTEM" "$CURSOR_REPO" "md" "$dry_run" "pull"

    echo -e "\n${BLUE}Gemini Commands${NC}"
    sync_files "$GEMINI_SYSTEM" "$GEMINI_REPO" "toml" "$dry_run" "pull"

    if [[ "$dry_run" == "true" ]]; then
        echo -e "\n${YELLOW}Run with --confirm to apply changes${NC}"
    else
        echo -e "\n${GREEN}Done${NC}"
    fi
}

cmd_push() {
    local dry_run="$1"

    if [[ "$dry_run" == "true" ]]; then
        echo -e "${YELLOW}DRY RUN - use --confirm to actually push${NC}\n"
    else
        echo -e "${GREEN}Pushing from repo to system...${NC}\n"
    fi

    echo -e "${BLUE}Claude Commands${NC}"
    sync_files "$CLAUDE_REPO" "$CLAUDE_SYSTEM" "md" "$dry_run" "push"

    echo -e "\n${BLUE}Codex Prompts${NC}"
    sync_files "$CODEX_REPO" "$CODEX_SYSTEM" "md" "$dry_run" "push"

    echo -e "\n${BLUE}Cursor Commands${NC}"
    sync_files "$CURSOR_REPO" "$CURSOR_SYSTEM" "md" "$dry_run" "push"

    echo -e "\n${BLUE}Gemini Commands${NC}"
    sync_files "$GEMINI_REPO" "$GEMINI_SYSTEM" "toml" "$dry_run" "push"

    if [[ "$dry_run" == "true" ]]; then
        echo -e "\n${YELLOW}Run with --confirm to apply changes${NC}"
    else
        echo -e "\n${GREEN}Done${NC}"
    fi
}

# Parse arguments
[[ $# -lt 1 ]] && usage

CMD="$1"
shift

CONFIRM=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --confirm)
            CONFIRM=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            usage
            ;;
    esac
done

DRY_RUN=true
[[ "$CONFIRM" == "true" ]] && DRY_RUN=false

case "$CMD" in
    status)
        cmd_status
        ;;
    pull)
        cmd_pull "$DRY_RUN"
        ;;
    push)
        cmd_push "$DRY_RUN"
        ;;
    *)
        echo "Unknown command: $CMD"
        usage
        ;;
esac
