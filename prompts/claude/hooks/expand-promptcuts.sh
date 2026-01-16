#!/bin/bash
# Expands prompt shortcuts defined in ~/.claude/promptcuts.yaml

PROMPTCUTS_FILE="$HOME/.claude/promptcuts.yaml"

# Read JSON input and extract prompt
INPUT_JSON=$(cat)
PROMPT=$(echo "$INPUT_JSON" | python3 -c "import sys, json; print(json.load(sys.stdin).get('prompt', ''))" 2>/dev/null)

[ ! -f "$PROMPTCUTS_FILE" ] || [ -z "$PROMPT" ] && exit 0

# Expand shortcuts
python3 -c "
import yaml, os, sys

prompt = sys.argv[1]
with open(os.path.expanduser('~/.claude/promptcuts.yaml')) as f:
    shortcuts = yaml.safe_load(f).get('shortcuts', {})

for shortcut, expansion in shortcuts.items():
    if shortcut in prompt:
        prompt = prompt.replace(shortcut, expansion.strip())
        print('<user-prompt-submit-hook>')
        print(prompt)
        print('</user-prompt-submit-hook>')
        break
" "$PROMPT" 2>/dev/null

exit 0
