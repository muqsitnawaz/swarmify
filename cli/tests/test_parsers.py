"""Tests for parsers.py - critical for normalizing different CLI formats."""

import pytest
from agent_swarm.parsers import normalize_event


class TestCodexParser:
    """Test Codex CLI output parsing."""

    def test_thread_started(self):
        """Test thread.started event normalization."""
        raw = {"type": "thread.started", "thread_id": "test-123"}
        event = normalize_event("codex", raw)

        assert event["type"] == "init"
        assert event["agent"] == "codex"
        assert event["session_id"] == "test-123"
        assert "timestamp" in event

    def test_turn_started(self):
        """Test turn.started event normalization."""
        raw = {"type": "turn.started"}
        event = normalize_event("codex", raw)

        assert event["type"] == "turn_start"
        assert event["agent"] == "codex"

    def test_agent_message(self):
        """Test agent_message item normalization."""
        raw = {
            "type": "item.completed",
            "item": {
                "type": "agent_message",
                "text": "Hello, I'm working on this task.",
            },
        }
        event = normalize_event("codex", raw)

        assert event["type"] == "message"
        assert event["agent"] == "codex"
        assert event["content"] == "Hello, I'm working on this task."
        assert event["complete"] is True

    def test_file_write_tool(self):
        """Test file write tool call normalization."""
        raw = {
            "type": "item.completed",
            "item": {
                "type": "tool_call",
                "name": "write_file",
                "arguments": {"path": "src/auth.ts", "content": "..."},
            },
        }
        event = normalize_event("codex", raw)

        assert event["type"] == "file_write"
        assert event["agent"] == "codex"
        assert event["tool"] == "write_file"
        assert event["path"] == "src/auth.ts"

    def test_file_read_tool(self):
        """Test file read tool call normalization."""
        raw = {
            "type": "item.completed",
            "item": {
                "type": "tool_call",
                "name": "read_file",
                "arguments": {"path": "src/auth.ts"},
            },
        }
        event = normalize_event("codex", raw)

        assert event["type"] == "file_read"
        assert event["path"] == "src/auth.ts"

    def test_bash_tool(self):
        """Test bash/shell tool call normalization."""
        raw = {
            "type": "item.completed",
            "item": {
                "type": "tool_call",
                "name": "shell",
                "arguments": {"command": "npm install"},
            },
        }
        event = normalize_event("codex", raw)

        assert event["type"] == "bash"
        assert event["tool"] == "shell"
        assert event["command"] == "npm install"

    def test_turn_completed(self):
        """Test turn.completed event normalization."""
        raw = {
            "type": "turn.completed",
            "usage": {"input_tokens": 100, "output_tokens": 50},
        }
        event = normalize_event("codex", raw)

        assert event["type"] == "result"
        assert event["agent"] == "codex"
        assert event["status"] == "success"
        assert event["usage"]["input_tokens"] == 100
        assert event["usage"]["output_tokens"] == 50

    def test_unknown_tool(self):
        """Test unknown tool call normalization."""
        raw = {
            "type": "item.completed",
            "item": {
                "type": "tool_call",
                "name": "custom_tool",
                "arguments": {"arg1": "value1"},
            },
        }
        event = normalize_event("codex", raw)

        assert event["type"] == "tool_use"
        assert event["tool"] == "custom_tool"
        assert event["args"] == {"arg1": "value1"}


class TestCursorParser:
    """Test Cursor CLI output parsing."""

    def test_system_init(self):
        """Test system/init event normalization."""
        raw = {
            "type": "system",
            "subtype": "init",
            "model": "claude-3-5-sonnet",
            "session_id": "cursor-123",
        }
        event = normalize_event("cursor", raw)

        assert event["type"] == "init"
        assert event["agent"] == "cursor"
        assert event["model"] == "claude-3-5-sonnet"
        assert event["session_id"] == "cursor-123"

    def test_thinking_complete(self):
        """Test thinking event normalization (complete)."""
        raw = {
            "type": "thinking",
            "subtype": "complete",
            "text": "I need to implement authentication.",
        }
        event = normalize_event("cursor", raw)

        assert event["type"] == "thinking"
        assert event["agent"] == "cursor"
        assert event["content"] == "I need to implement authentication."
        assert event["complete"] is True

    def test_thinking_delta(self):
        """Test thinking event normalization (delta)."""
        raw = {
            "type": "thinking",
            "subtype": "delta",
            "text": "I need",
        }
        event = normalize_event("cursor", raw)

        assert event["type"] == "thinking"
        assert event["complete"] is False

    def test_assistant_message(self):
        """Test assistant message normalization."""
        raw = {
            "type": "assistant",
            "message": {
                "content": [{"type": "text", "text": "I'll implement auth now."}],
            },
        }
        event = normalize_event("cursor", raw)

        assert event["type"] == "message"
        assert event["agent"] == "cursor"
        assert event["content"] == "I'll implement auth now."
        assert event["complete"] is True

    def test_assistant_tool_use(self):
        """Test assistant message with tool use."""
        raw = {
            "type": "assistant",
            "message": {
                "content": [
                    {
                        "type": "tool_use",
                        "name": "write_file",
                        "input": {"path": "src/auth.ts"},
                    }
                ],
            },
        }
        event = normalize_event("cursor", raw)

        assert event["type"] == "tool_use"
        assert event["tool"] == "write_file"
        assert event["args"] == {"path": "src/auth.ts"}

    def test_result_success(self):
        """Test result event normalization (success)."""
        raw = {
            "type": "result",
            "subtype": "success",
            "duration_ms": 5000,
        }
        event = normalize_event("cursor", raw)

        assert event["type"] == "result"
        assert event["status"] == "success"
        assert event["duration_ms"] == 5000

    def test_result_error(self):
        """Test result event normalization (error)."""
        raw = {
            "type": "result",
            "subtype": "error",
            "duration_ms": 1000,
        }
        event = normalize_event("cursor", raw)

        assert event["type"] == "result"
        assert event["status"] == "error"


class TestGeminiParser:
    """Test Gemini CLI output parsing."""

    def test_init(self):
        """Test init event normalization."""
        raw = {
            "type": "init",
            "timestamp": "2024-01-01T00:00:00Z",
            "session_id": "gemini-123",
            "model": "gemini-pro",
        }
        event = normalize_event("gemini", raw)

        assert event["type"] == "init"
        assert event["agent"] == "gemini"
        assert event["session_id"] == "gemini-123"
        assert event["model"] == "gemini-pro"

    def test_message_complete(self):
        """Test complete message normalization."""
        raw = {
            "type": "message",
            "role": "assistant",
            "content": "Task completed successfully.",
            "delta": False,
        }
        event = normalize_event("gemini", raw)

        assert event["type"] == "message"
        assert event["agent"] == "gemini"
        assert event["content"] == "Task completed successfully."
        assert event["complete"] is True

    def test_message_delta(self):
        """Test delta message normalization."""
        raw = {
            "type": "message",
            "role": "assistant",
            "content": "Task",
            "delta": True,
        }
        event = normalize_event("gemini", raw)

        assert event["type"] == "message"
        assert event["complete"] is False

    def test_file_write_tool(self):
        """Test file write tool call detection."""
        raw = {
            "type": "tool_call",
            "name": "write_file",
            "args": {"path": "src/test.ts"},
        }
        event = normalize_event("gemini", raw)

        assert event["type"] == "file_write"
        assert event["path"] == "src/test.ts"

    def test_bash_tool(self):
        """Test bash tool call detection."""
        raw = {
            "type": "tool_call",
            "name": "run_command",
            "args": {"command": "npm test"},
        }
        event = normalize_event("gemini", raw)

        assert event["type"] == "bash"
        assert event["command"] == "npm test"

    def test_result_success(self):
        """Test result event normalization."""
        raw = {
            "type": "result",
            "status": "success",
            "stats": {"duration_ms": 3000, "total_tokens": 150},
        }
        event = normalize_event("gemini", raw)

        assert event["type"] == "result"
        assert event["status"] == "success"
        assert event["duration_ms"] == 3000
        assert event["usage"]["total_tokens"] == 150

    def test_tool_call_missing_fields(self):
        """Tool events without names/args should still normalize safely."""
        raw = {
            "type": "tool_call",
            "name": None,
            "args": None,
        }
        event = normalize_event("gemini", raw)

        assert event["type"] == "tool_use"
        assert event["tool"] == "unknown"
        assert event["args"] == {}


class TestClaudeParser:
    """Test Claude CLI output parsing (uses Cursor format)."""

    def test_claude_uses_cursor_format(self):
        """Test that Claude parser uses Cursor normalization."""
        raw = {
            "type": "system",
            "subtype": "init",
            "model": "claude-3-5-sonnet",
        }
        event = normalize_event("claude", raw)

        assert event["type"] == "init"
        assert event["agent"] == "claude"
        assert event["model"] == "claude-3-5-sonnet"


class TestParserEdgeCases:
    """Test edge cases and error handling."""

    def test_unknown_event_type(self):
        """Test handling of unknown event types."""
        raw = {"type": "unknown_event", "data": "something"}
        event = normalize_event("codex", raw)

        assert event["type"] == "unknown_event"
        assert event["agent"] == "codex"
        assert "raw" in event or "timestamp" in event

    def test_missing_fields(self):
        """Test handling of missing optional fields."""
        raw = {"type": "item.completed", "item": {"type": "agent_message"}}
        event = normalize_event("codex", raw)

        assert event["type"] == "message"
        assert event.get("content", "") == ""

    def test_empty_tool_args(self):
        """Test handling of empty tool arguments."""
        raw = {
            "type": "item.completed",
            "item": {"type": "tool_call", "name": "write_file", "arguments": {}},
        }
        event = normalize_event("codex", raw)

        assert event["type"] == "file_write"
        assert event.get("path", "") == ""
