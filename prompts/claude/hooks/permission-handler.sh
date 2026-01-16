#!/bin/bash

json_input=$(cat)

tool_name=$(echo "$json_input" | jq -r '.tool_name // ""')
tool_input=$(echo "$json_input" | jq -r '.tool_input // ""')
message=$(echo "$json_input" | jq -r '.message // ""')

tool_input_formatted=$(echo "$tool_input" | jq -c '.' 2>/dev/null || echo "$tool_input")

export TOOL_NAME="$tool_name"
export MESSAGE="$message"
export TOOL_INPUT="$tool_input_formatted"

result=$(osascript <<'APPLESCRIPT'
set toolName to system attribute "TOOL_NAME"
set msg to system attribute "MESSAGE"
set toolInput to system attribute "TOOL_INPUT"

set dialogText to "Tool: " & toolName & return & return & "Message: " & msg & return & return & "Tool Input:" & return & toolInput

button returned of (display dialog dialogText buttons {"Deny", "Approve"} default button "Approve" with title "Permission Request" with icon caution)
APPLESCRIPT
)

if [ "$result" = "Approve" ]; then
    echo '{"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "allow"}}}'
else
    echo '{"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "deny", "message": "User denied this permission"}}}'
fi
