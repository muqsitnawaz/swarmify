#!/usr/bin/env python3
"""
Claude Code Permission Handler

Shows a clean, readable permission dialog with:
- Human-readable summary (not raw JSON)
- Session context (first user message)
- Claude icon
- Deny/Allow buttons
"""

import glob
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse


def get_first_message(session_id: str) -> str:
    """Look up the first user message from the session file."""
    base = Path.home() / ".claude" / "projects"
    for session_file in glob.glob(str(base / "*" / f"{session_id}.jsonl")):
        try:
            with open(session_file) as f:
                for line in f:
                    try:
                        rec = json.loads(line)
                        if rec.get("type") == "user":
                            msg = rec.get("message", {}).get("content", "")
                            if msg:
                                return msg[:60] + "..." if len(msg) > 60 else msg
                    except json.JSONDecodeError:
                        continue
        except (IOError, OSError):
            continue
    return "Unknown session"


def generate_summary(tool_name: str, tool_input: dict) -> str:
    """Generate a human-readable summary based on tool type."""
    if tool_name == "Edit":
        file_path = tool_input.get("file_path", "unknown")
        basename = Path(file_path).name
        old_len = len(tool_input.get("old_string", ""))
        new_len = len(tool_input.get("new_string", ""))
        return f"Edit {basename}\n{old_len} -> {new_len} chars"

    elif tool_name == "Write":
        file_path = tool_input.get("file_path", "unknown")
        basename = Path(file_path).name
        content_len = len(tool_input.get("content", ""))
        return f"Write {basename}\n{content_len} bytes"

    elif tool_name == "Read":
        file_path = tool_input.get("file_path", "unknown")
        basename = Path(file_path).name
        return f"Read {basename}"

    elif tool_name == "Bash":
        command = tool_input.get("command", "")
        truncated = command[:80] + "..." if len(command) > 80 else command
        return f"$ {truncated}"

    elif tool_name == "WebFetch":
        url = tool_input.get("url", "unknown")
        try:
            domain = urlparse(url).netloc
        except Exception:
            domain = url[:40]
        return f"Fetch {domain}"

    elif tool_name.startswith("mcp__"):
        parts = tool_name.split("__")
        if len(parts) >= 3:
            server = parts[1]
            tool = parts[2]
            return f"MCP: {server} -> {tool}"
        return f"MCP: {tool_name}"

    else:
        # Generic fallback
        return f"{tool_name}"


def show_dialog(session_context: str, tool_summary: str) -> str:
    """Show AppleScript dialog and return user choice."""
    icon_path = Path.home() / ".claude" / "assets" / "claude-icon.icns"

    # Escape for AppleScript: replace quotes and remove newlines
    session_clean = session_context.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ")
    summary_clean = tool_summary.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " | ")

    # display alert doesn't support custom icons, so use display dialog with icon file
    # if we have a custom icon, otherwise use display alert for larger text
    if icon_path.exists():
        # Use display dialog with custom icon
        applescript = f"""
set sessionLine to "{session_clean}"
set summaryLine to "{summary_clean}"
set fullText to sessionLine & return & return & summaryLine
try
    set btnResult to button returned of (display dialog fullText buttons {{"Deny", "Allow"}} default button "Allow" with title "Claude Permission" with icon file (POSIX file "{icon_path}"))
    return btnResult
on error
    return "Deny"
end try
"""
    else:
        # Use display alert (larger text, no custom icon)
        applescript = f"""
set sessionLine to "{session_clean}"
set summaryLine to "{summary_clean}"
try
    set btnResult to button returned of (display alert sessionLine message summaryLine buttons {{"Deny", "Allow"}} default button "Allow")
    return btnResult
on error
    return "Deny"
end try
"""

    try:
        result = subprocess.run(["osascript", "-e", applescript], capture_output=True, text=True, timeout=60)
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        return "Deny"
    except Exception:
        return "Deny"


def main():
    # Read JSON input from stdin
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        # If we can't parse input, deny by default
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PermissionRequest",
                        "decision": {"behavior": "deny", "message": "Failed to parse input"},
                    }
                }
            )
        )
        return

    session_id = input_data.get("session_id", "")
    tool_name = input_data.get("tool_name", "Unknown")
    tool_input = input_data.get("tool_input", {})

    # Parse tool_input if it's a string
    if isinstance(tool_input, str):
        try:
            tool_input = json.loads(tool_input)
        except json.JSONDecodeError:
            tool_input = {"raw": tool_input}

    # Get session context and tool summary
    session_context = get_first_message(session_id)
    tool_summary = generate_summary(tool_name, tool_input)

    # Show dialog
    choice = show_dialog(session_context, tool_summary)

    # Return decision
    if choice == "Allow":
        decision = {"behavior": "allow"}
    else:
        decision = {"behavior": "deny", "message": "User denied permission"}

    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": decision}}))


if __name__ == "__main__":
    main()
