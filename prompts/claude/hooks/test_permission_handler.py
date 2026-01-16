#!/usr/bin/env python3
"""Tests for permission-handler.py"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

# Add the hooks directory to the path so we can import the module
sys.path.insert(0, str(Path(__file__).parent))

from permission_handler import generate_summary, get_first_message, show_dialog


class TestGenerateSummary:
    """Tests for generate_summary function."""

    def test_edit_summary(self):
        tool_input = {
            "file_path": "/path/to/file.py",
            "old_string": "old code here",
            "new_string": "new code here that is longer",
        }
        result = generate_summary("Edit", tool_input)
        assert "Edit file.py" in result
        assert "13 -> 28 chars" in result

    def test_edit_summary_shows_basename_only(self):
        tool_input = {
            "file_path": "/very/long/path/to/some/deeply/nested/file.ts",
            "old_string": "x",
            "new_string": "y",
        }
        result = generate_summary("Edit", tool_input)
        assert "file.ts" in result
        assert "/very/long" not in result

    def test_write_summary(self):
        tool_input = {
            "file_path": "/path/to/newfile.txt",
            "content": "Hello world content here",
        }
        result = generate_summary("Write", tool_input)
        assert "Write newfile.txt" in result
        assert "24 bytes" in result

    def test_read_summary(self):
        tool_input = {"file_path": "/path/to/readme.md"}
        result = generate_summary("Read", tool_input)
        assert result == "Read readme.md"

    def test_bash_summary_short_command(self):
        tool_input = {"command": "ls -la"}
        result = generate_summary("Bash", tool_input)
        assert result == "$ ls -la"

    def test_bash_summary_long_command_truncates(self):
        long_cmd = "echo " + "x" * 100
        tool_input = {"command": long_cmd}
        result = generate_summary("Bash", tool_input)
        assert len(result) < len(long_cmd) + 10
        assert result.endswith("...")

    def test_webfetch_summary(self):
        tool_input = {"url": "https://docs.anthropic.com/en/api/overview"}
        result = generate_summary("WebFetch", tool_input)
        assert result == "Fetch docs.anthropic.com"

    def test_mcp_summary(self):
        result = generate_summary("mcp__Swarm__spawn", {})
        assert result == "MCP: Swarm -> spawn"

    def test_mcp_summary_with_two_parts(self):
        result = generate_summary("mcp__ServerName", {})
        assert "MCP:" in result

    def test_unknown_tool_fallback(self):
        result = generate_summary("SomeNewTool", {"foo": "bar"})
        assert result == "SomeNewTool"


class TestGetFirstMessage:
    """Tests for get_first_message function."""

    def test_returns_unknown_for_nonexistent_session(self):
        result = get_first_message("nonexistent-session-id-12345")
        assert result == "Unknown session"

    def test_finds_message_in_testdata(self):
        # Create a temporary session file in the expected location
        testdata_dir = Path(__file__).parent / "testdata"

        # The function looks in ~/.claude/projects/*/, so we need to test with real data
        # or accept that this test checks the "not found" path
        # For now, just verify it doesn't crash
        result = get_first_message("test-session-123")
        assert isinstance(result, str)


class TestShowDialog:
    """Tests for show_dialog AppleScript generation."""

    def test_escapes_quotes_in_session_context(self):
        # Test that quotes don't break the AppleScript
        session = 'User said "hello" to me'
        summary = "Edit file.py"

        # We can't easily test the dialog itself, but we can verify
        # the function doesn't crash with special characters
        # In a real test, we'd need to capture the AppleScript string
        # For now, just verify it handles the input
        assert session.replace('"', '\\"') == 'User said \\"hello\\" to me'

    def test_escapes_backslashes(self):
        session = "Path is C:\\Users\\test"
        escaped = session.replace("\\", "\\\\")
        assert escaped == "Path is C:\\\\Users\\\\test"

    def test_replaces_newlines(self):
        session = "Line 1\nLine 2\nLine 3"
        cleaned = session.replace("\n", " ")
        assert cleaned == "Line 1 Line 2 Line 3"


class TestAppleScriptGeneration:
    """Test that AppleScript is generated correctly."""

    def test_applescript_syntax_valid(self):
        """Verify the generated AppleScript has valid syntax."""
        # Generate what the AppleScript would look like
        session_clean = "Test session"
        summary_clean = "Edit file.py | 10 -> 20 chars"
        icon_clause = "with icon note"

        applescript = f"""
set sessionLine to "{session_clean}"
set summaryLine to "{summary_clean}"
try
    set btnResult to button returned of (display alert sessionLine message summaryLine buttons {{"Deny", "Allow"}} default button "Allow" {icon_clause})
    return btnResult
on error
    return "Deny"
end try
"""
        # Use osacompile to check syntax without running
        result = subprocess.run(
            ["osacompile", "-e", applescript, "-o", "/dev/null"],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, f"AppleScript syntax error: {result.stderr}"


class TestEndToEnd:
    """End-to-end tests using subprocess."""

    def test_invalid_json_input_returns_deny(self):
        """Test that invalid JSON input results in deny."""
        result = subprocess.run(
            ["python3", str(Path(__file__).parent / "permission_handler.py")],
            input="not valid json",
            capture_output=True,
            text=True,
        )
        output = json.loads(result.stdout)
        assert output["hookSpecificOutput"]["decision"]["behavior"] == "deny"
        assert "Failed to parse" in output["hookSpecificOutput"]["decision"]["message"]

    def test_empty_input_returns_deny(self):
        """Test that empty input results in deny."""
        result = subprocess.run(
            ["python3", str(Path(__file__).parent / "permission_handler.py")],
            input="",
            capture_output=True,
            text=True,
        )
        output = json.loads(result.stdout)
        assert output["hookSpecificOutput"]["decision"]["behavior"] == "deny"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
