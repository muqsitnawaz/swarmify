"""Tests for summarizer.py - critical for context management."""

import pytest
from agent_swarm.summarizer import (
    AgentSummary,
    summarize_events,
    get_delta,
    filter_events_by_priority,
    _extract_file_ops_from_bash,
)


class TestSummarizeEvents:
    """Test event summarization."""

    def test_empty_events(self):
        """Test summarization of empty event list."""
        summary = summarize_events(
            agent_id="test-1",
            agent_type="codex",
            status="running",
            events=[],
            duration=None,
        )

        assert summary.agent_id == "test-1"
        assert summary.agent_type == "codex"
        assert summary.status == "running"
        assert len(summary.files_modified) == 0
        assert len(summary.tools_used) == 0
        assert summary.tool_call_count == 0

    def test_file_operations(self):
        """Test extraction of file operations."""
        events = [
            {"type": "file_write", "path": "src/auth.ts", "timestamp": "2024-01-01"},
            {"type": "file_create", "path": "src/types.ts", "timestamp": "2024-01-01"},
            {"type": "file_read", "path": "src/config.ts", "timestamp": "2024-01-01"},
            {"type": "file_delete", "path": "src/old.ts", "timestamp": "2024-01-01"},
        ]

        summary = summarize_events(
            agent_id="test-2",
            agent_type="codex",
            status="completed",
            events=events,
            duration="5 seconds",
        )

        assert "src/auth.ts" in summary.files_modified
        assert "src/types.ts" in summary.files_created
        assert "src/config.ts" in summary.files_read
        assert "src/old.ts" in summary.files_deleted
        assert summary.tool_call_count == 4

    def test_tool_usage_tracking(self):
        """Test tracking of tool usage."""
        events = [
            {"type": "tool_use", "tool": "write_file", "timestamp": "2024-01-01"},
            {"type": "tool_use", "tool": "read_file", "timestamp": "2024-01-01"},
            {"type": "bash", "command": "npm install", "timestamp": "2024-01-01"},
            {"type": "bash", "command": "npm test", "timestamp": "2024-01-01"},
        ]

        summary = summarize_events(
            agent_id="test-3",
            agent_type="codex",
            status="running",
            events=events,
        )

        assert "write_file" in summary.tools_used
        assert "read_file" in summary.tools_used
        assert "bash" in summary.tools_used
        assert summary.tool_call_count == 4
        assert len(summary.bash_commands) == 2
        assert "npm install" in summary.bash_commands
        assert "npm test" in summary.bash_commands

    def test_error_extraction(self):
        """Test extraction of errors."""
        events = [
            {"type": "error", "message": "File not found", "timestamp": "2024-01-01"},
            {
                "type": "result",
                "status": "error",
                "message": "Task failed",
                "timestamp": "2024-01-01",
            },
        ]

        summary = summarize_events(
            agent_id="test-4",
            agent_type="codex",
            status="failed",
            events=events,
        )

        assert len(summary.errors) == 2
        assert "File not found" in summary.errors
        assert "Task failed" in summary.errors

    def test_final_message_extraction(self):
        """Test extraction of final message."""
        events = [
            {
                "type": "message",
                "content": "Starting task...",
                "complete": False,
                "timestamp": "2024-01-01",
            },
            {
                "type": "message",
                "content": "Task completed successfully!",
                "complete": True,
                "timestamp": "2024-01-01",
            },
        ]

        summary = summarize_events(
            agent_id="test-5",
            agent_type="codex",
            status="completed",
            events=events,
        )

        assert summary.final_message == "Task completed successfully!"

    def test_duration_extraction(self):
        """Test duration extraction from result event."""
        events = [
            {
                "type": "result",
                "status": "success",
                "duration_ms": 7500,
                "timestamp": "2024-01-01",
            }
        ]

        summary = summarize_events(
            agent_id="test-6",
            agent_type="codex",
            status="completed",
            events=events,
            duration=None,
        )

        assert summary.duration == "7.5 seconds"

    def test_event_count(self):
        """Test event count tracking."""
        events = [{"type": "init", "timestamp": "2024-01-01"}] * 10

        summary = summarize_events(
            agent_id="test-7",
            agent_type="codex",
            status="running",
            events=events,
        )

        assert summary.event_count == 10


class TestSummaryToDict:
    """Test summary serialization to dict."""

    def test_brief_detail_level(self):
        """Test brief detail level output."""
        events = [
            {"type": "file_write", "path": "src/auth.ts", "timestamp": "2024-01-01"},
            {"type": "file_write", "path": "src/types.ts", "timestamp": "2024-01-01"},
            {"type": "file_write", "path": "src/config.ts", "timestamp": "2024-01-01"},
            {"type": "file_write", "path": "src/utils.ts", "timestamp": "2024-01-01"},
            {"type": "file_write", "path": "src/main.ts", "timestamp": "2024-01-01"},
            {"type": "file_write", "path": "src/extra.ts", "timestamp": "2024-01-01"},
        ]

        summary = summarize_events(
            agent_id="test-8",
            agent_type="codex",
            status="completed",
            events=events,
            duration="5 seconds",
        )

        result = summary.to_dict("brief")

        assert result["agent_id"] == "test-8"
        assert result["agent_type"] == "codex"
        assert result["status"] == "completed"
        assert len(result["files_modified"]) == 5
        assert "files_created" in result
        assert "has_errors" in result
        # Brief now includes activity indicators
        assert result["duration"] == "5 seconds"
        assert result["tool_call_count"] == 6
        assert result["last_activity"] == "file_write"
        assert "tools_used" not in result  # Still excluded from brief

    def test_standard_detail_level(self):
        """Test standard detail level output."""
        events = [
            {"type": "file_write", "path": "src/auth.ts", "timestamp": "2024-01-01"},
            {"type": "tool_use", "tool": "write_file", "timestamp": "2024-01-01"},
            {
                "type": "message",
                "content": "Done!" * 100,
                "complete": True,
                "timestamp": "2024-01-01",
            },
        ]

        summary = summarize_events(
            agent_id="test-9",
            agent_type="codex",
            status="completed",
            events=events,
            duration="5 seconds",
        )

        result = summary.to_dict("standard")

        assert result["duration"] == "5 seconds"
        assert "files_modified" in result
        assert "tools_used" in result
        assert "tool_call_count" in result
        assert "errors" in result
        assert result["final_message"] is not None
        # Standard detail preserves messages up to 2000 chars
        assert len(result["final_message"]) <= 2003

    def test_detailed_detail_level(self):
        """Test detailed detail level output."""
        events = [
            {"type": "file_write", "path": "src/auth.ts", "timestamp": "2024-01-01"},
            {"type": "file_read", "path": "src/config.ts", "timestamp": "2024-01-01"},
            {"type": "bash", "command": "npm install", "timestamp": "2024-01-01"},
            {"type": "bash", "command": "npm test", "timestamp": "2024-01-01"},
        ]

        summary = summarize_events(
            agent_id="test-10",
            agent_type="codex",
            status="completed",
            events=events,
        )

        result = summary.to_dict("detailed")

        assert "files_read" in result
        assert "files_deleted" in result
        assert "bash_commands" in result
        assert "warnings" in result
        assert "event_count" in result
        assert "last_activity" in result
        assert len(result["bash_commands"]) == 2


class TestGetDelta:
    """Test delta format generation."""

    def test_no_new_events(self):
        """Test delta when no new events."""
        events = [
            {"type": "init", "timestamp": "2024-01-01"},
            {"type": "file_write", "path": "src/auth.ts", "timestamp": "2024-01-01"},
        ]

        delta = get_delta(
            agent_id="test-11",
            agent_type="codex",
            status="completed",
            events=events,
            since_event=2,
        )

        assert delta["new_events_count"] == 0
        assert delta["has_changes"] is False
        assert delta["since_event"] == 2

    def test_new_events(self):
        """Test delta with new events."""
        events = [
            {"type": "init", "timestamp": "2024-01-01"},
            {"type": "file_write", "path": "src/auth.ts", "timestamp": "2024-01-01"},
            {"type": "file_write", "path": "src/types.ts", "timestamp": "2024-01-01"},
            {"type": "bash", "command": "npm install", "timestamp": "2024-01-01"},
        ]

        delta = get_delta(
            agent_id="test-12",
            agent_type="codex",
            status="running",
            events=events,
            since_event=1,
        )

        assert delta["new_events_count"] == 3
        assert delta["has_changes"] is True
        assert delta["current_event_count"] == 4
        assert "src/types.ts" in delta["new_files_modified"]
        assert len(delta["new_tool_calls"]) > 0

    def test_delta_includes_latest_message(self):
        """Test that delta includes latest message."""
        events = [
            {"type": "init", "timestamp": "2024-01-01"},
            {
                "type": "message",
                "content": "Working on it...",
                "complete": True,
                "timestamp": "2024-01-01",
            },
        ]

        delta = get_delta(
            agent_id="test-13",
            agent_type="codex",
            status="running",
            events=events,
            since_event=0,
        )

        assert delta["latest_message"] == "Working on it..."

    def test_delta_includes_new_errors(self):
        """Test that delta includes new errors."""
        events = [
            {"type": "init", "timestamp": "2024-01-01"},
            {"type": "error", "message": "Something went wrong", "timestamp": "2024-01-01"},
        ]

        delta = get_delta(
            agent_id="test-14",
            agent_type="codex",
            status="failed",
            events=events,
            since_event=0,
        )

        assert len(delta["new_errors"]) > 0
        assert "Something went wrong" in delta["new_errors"][0]


class TestEventPriorityFiltering:
    """Test event priority filtering."""

    def test_filter_critical_only(self):
        """Test filtering to critical events only."""
        events = [
            {"type": "init", "timestamp": "2024-01-01"},
            {"type": "file_write", "path": "src/auth.ts", "timestamp": "2024-01-01"},
            {"type": "error", "message": "Failed", "timestamp": "2024-01-01"},
            {"type": "thinking", "content": "Hmm...", "timestamp": "2024-01-01"},
        ]

        filtered = filter_events_by_priority(events, include_levels=["critical"])

        assert len(filtered) == 2
        assert any(e["type"] == "file_write" for e in filtered)
        assert any(e["type"] == "error" for e in filtered)
        assert not any(e["type"] == "init" for e in filtered)
        assert not any(e["type"] == "thinking" for e in filtered)

    def test_filter_critical_and_important(self):
        """Test filtering to critical and important events."""
        events = [
            {"type": "init", "timestamp": "2024-01-01"},
            {"type": "file_write", "path": "src/auth.ts", "timestamp": "2024-01-01"},
            {"type": "tool_use", "tool": "read_file", "timestamp": "2024-01-01"},
            {"type": "thinking", "content": "Hmm...", "complete": True, "timestamp": "2024-01-01"},
        ]

        filtered = filter_events_by_priority(events, include_levels=["critical", "important"])

        assert len(filtered) == 3
        assert any(e["type"] == "file_write" for e in filtered)
        assert any(e["type"] == "tool_use" for e in filtered)
        assert any(e["type"] == "thinking" for e in filtered)
        assert not any(e["type"] == "init" for e in filtered)

    def test_filter_default(self):
        """Test default filtering (critical + important)."""
        events = [
            {"type": "init", "timestamp": "2024-01-01"},
            {"type": "file_write", "path": "src/auth.ts", "timestamp": "2024-01-01"},
            {"type": "bash", "command": "npm install", "timestamp": "2024-01-01"},
            {"type": "message", "content": "Done", "complete": True, "timestamp": "2024-01-01"},
        ]

        filtered = filter_events_by_priority(events)

        assert len(filtered) == 3
        assert any(e["type"] == "file_write" for e in filtered)
        assert any(e["type"] == "bash" for e in filtered)
        assert any(e["type"] == "message" for e in filtered)
        assert not any(e["type"] == "init" for e in filtered)


class TestBashCommandParsing:
    """Test bash command parsing for file operations."""

    def test_sed_read(self):
        """Test sed -n read detection."""
        files_read, files_written = _extract_file_ops_from_bash(
            "sed -n '1,100p' path/to/file.tsx"
        )
        assert "path/to/file.tsx" in files_read
        assert len(files_written) == 0

    def test_sed_write(self):
        """Test sed -i write detection."""
        files_read, files_written = _extract_file_ops_from_bash(
            "sed -i 's/old/new/' file.ts"
        )
        assert "file.ts" in files_written
        assert len(files_read) == 0

    def test_cat_redirect_write(self):
        """Test cat > file write detection."""
        files_read, files_written = _extract_file_ops_from_bash(
            "cat > src/App.tsx << 'EOF'"
        )
        assert "src/App.tsx" in files_written

    def test_echo_redirect_write(self):
        """Test echo > file write detection."""
        files_read, files_written = _extract_file_ops_from_bash(
            'echo "content" > output.txt'
        )
        assert "output.txt" in files_written

    def test_tee_write(self):
        """Test tee file write detection."""
        files_read, files_written = _extract_file_ops_from_bash(
            "echo test | tee output.log"
        )
        assert "output.log" in files_written

    def test_wrapped_zsh_command(self):
        """Test unwrapping /bin/zsh -lc wrapper."""
        files_read, files_written = _extract_file_ops_from_bash(
            '/bin/zsh -lc "sed -n \'1,240p\' rush/app/src/App.tsx"'
        )
        assert "rush/app/src/App.tsx" in files_read

    def test_head_tail_read(self):
        """Test head/tail read detection."""
        files_read, _ = _extract_file_ops_from_bash("head -100 file.txt")
        assert "file.txt" in files_read

        files_read, _ = _extract_file_ops_from_bash("tail -n 50 log.txt")
        assert "log.txt" in files_read

    def test_no_file_ops(self):
        """Test commands without file operations."""
        files_read, files_written = _extract_file_ops_from_bash("npm install")
        assert len(files_read) == 0
        assert len(files_written) == 0

    def test_summarize_events_extracts_bash_files(self):
        """Test that summarize_events extracts files from bash commands."""
        events = [
            {
                "type": "bash",
                "command": '/bin/zsh -lc "sed -n \'1,100p\' src/App.tsx"',
                "timestamp": "2024-01-01",
            },
            {
                "type": "bash",
                "command": "cat > src/new.tsx << 'EOF'",
                "timestamp": "2024-01-01",
            },
        ]

        summary = summarize_events(
            agent_id="test-bash",
            agent_type="codex",
            status="running",
            events=events,
        )

        assert "src/App.tsx" in summary.files_read
        assert "src/new.tsx" in summary.files_modified
        assert summary.tool_call_count == 2
