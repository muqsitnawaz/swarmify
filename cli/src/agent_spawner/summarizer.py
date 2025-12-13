"""Rule-based summarization for agent outputs.

Reduces token usage by ~99% while preserving key information.
"""

from dataclasses import dataclass, field
from typing import Literal


# Event priority for filtering
PRIORITY: dict[str, list[str]] = {
    "critical": [
        "error",
        "result",
        "file_write",
        "file_delete",
        "file_create",
    ],
    "important": [
        "tool_use",
        "bash",
        "file_read",
        "thinking",  # Only complete, not delta
        "message",  # Only complete
    ],
    "verbose": [
        "thinking_delta",
        "message_delta",
        "init",
        "turn_start",
        "user_message",
        "raw",
    ],
}


@dataclass
class AgentSummary:
    """Summarized output from an agent."""

    agent_id: str
    agent_type: str
    status: str
    duration_ms: int | None = None

    # Files
    files_modified: set[str] = field(default_factory=set)
    files_created: set[str] = field(default_factory=set)
    files_read: set[str] = field(default_factory=set)
    files_deleted: set[str] = field(default_factory=set)

    # Tools
    tools_used: set[str] = field(default_factory=set)
    tool_call_count: int = 0
    bash_commands: list[str] = field(default_factory=list)

    # Messages
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    final_message: str | None = None

    # Progress
    event_count: int = 0
    last_activity: str | None = None

    def to_dict(
        self, detail_level: Literal["brief", "standard", "detailed"] = "standard"
    ) -> dict:
        """Convert to dict with specified detail level."""
        base = {
            "agent_id": self.agent_id,
            "agent_type": self.agent_type,
            "status": self.status,
        }

        if detail_level == "brief":
            # ~50 tokens
            return {
                **base,
                "files_modified": list(self.files_modified)[:5],
                "files_created": list(self.files_created)[:5],
                "has_errors": len(self.errors) > 0,
            }

        elif detail_level == "standard":
            # ~200 tokens
            return {
                **base,
                "duration_ms": self.duration_ms,
                "files_modified": list(self.files_modified),
                "files_created": list(self.files_created),
                "tools_used": list(self.tools_used),
                "tool_call_count": self.tool_call_count,
                "errors": self.errors[:3],
                "final_message": self._truncate(self.final_message, 200),
            }

        else:  # detailed
            # ~500 tokens
            return {
                **base,
                "duration_ms": self.duration_ms,
                "files_modified": list(self.files_modified),
                "files_created": list(self.files_created),
                "files_read": list(self.files_read),
                "files_deleted": list(self.files_deleted),
                "tools_used": list(self.tools_used),
                "tool_call_count": self.tool_call_count,
                "bash_commands": self.bash_commands[-10:],
                "errors": self.errors,
                "warnings": self.warnings,
                "final_message": self._truncate(self.final_message, 500),
                "event_count": self.event_count,
                "last_activity": self.last_activity,
            }

    def _truncate(self, text: str | None, max_len: int) -> str | None:
        if not text:
            return None
        if len(text) <= max_len:
            return text
        return text[: max_len - 3] + "..."


def summarize_events(
    agent_id: str,
    agent_type: str,
    status: str,
    events: list[dict],
    duration_ms: int | None = None,
) -> AgentSummary:
    """
    Create a summary from a list of events.

    This is rule-based extraction with no LLM calls.
    """
    summary = AgentSummary(
        agent_id=agent_id,
        agent_type=agent_type,
        status=status,
        duration_ms=duration_ms,
        event_count=len(events),
    )

    for event in events:
        event_type = event.get("type", "unknown")
        summary.last_activity = event_type

        # File operations
        if event_type == "file_write":
            path = event.get("path", "")
            if path:
                summary.files_modified.add(path)
                summary.tool_call_count += 1

        elif event_type == "file_create":
            path = event.get("path", "")
            if path:
                summary.files_created.add(path)
                summary.tool_call_count += 1

        elif event_type == "file_read":
            path = event.get("path", "")
            if path:
                summary.files_read.add(path)
                summary.tool_call_count += 1

        elif event_type == "file_delete":
            path = event.get("path", "")
            if path:
                summary.files_deleted.add(path)
                summary.tool_call_count += 1

        # Tool use
        elif event_type == "tool_use":
            tool = event.get("tool", "unknown")
            summary.tools_used.add(tool)
            summary.tool_call_count += 1

        elif event_type == "bash":
            command = event.get("command", "")
            summary.tools_used.add("bash")
            if command:
                summary.bash_commands.append(command)
            summary.tool_call_count += 1

        # Messages - capture last non-empty content
        elif event_type == "message":
            content = event.get("content", "")
            if content:
                summary.final_message = content

        elif event_type == "error":
            error_msg = event.get("message", event.get("content", "Unknown error"))
            summary.errors.append(error_msg)

        elif event_type == "warning":
            warning_msg = event.get("message", event.get("content", ""))
            if warning_msg:
                summary.warnings.append(warning_msg)

        # Result
        elif event_type == "result":
            if event.get("status") == "error":
                error_msg = event.get("message", event.get("error", "Task failed"))
                summary.errors.append(error_msg)
            if not summary.duration_ms:
                summary.duration_ms = event.get("duration_ms")

    return summary


def get_delta(
    agent_id: str,
    agent_type: str,
    status: str,
    events: list[dict],
    since_event: int = 0,
) -> dict:
    """
    Get only changes since last read.

    Returns a compact delta update.
    """
    new_events = events[since_event:]
    if not new_events:
        return {
            "agent_id": agent_id,
            "status": status,
            "since_event": since_event,
            "new_events_count": 0,
            "has_changes": False,
        }

    # Summarize only new events
    summary = summarize_events(agent_id, agent_type, status, new_events)

    return {
        "agent_id": agent_id,
        "agent_type": agent_type,
        "status": status,
        "since_event": since_event,
        "new_events_count": len(new_events),
        "current_event_count": since_event + len(new_events),
        "has_changes": True,
        "new_files_modified": list(summary.files_modified),
        "new_files_created": list(summary.files_created),
        "new_tool_calls": [
            f"{e.get('tool', 'unknown')}: {e.get('command', e.get('path', ''))}"
            for e in new_events
            if e.get("type") in ("tool_use", "bash", "file_write")
        ][-5:],
        "latest_message": summary.final_message,
        "new_errors": summary.errors,
    }


def filter_events_by_priority(
    events: list[dict],
    include_levels: list[str] | None = None,
) -> list[dict]:
    """
    Filter events by priority level.

    Default includes critical and important, excludes verbose.
    """
    if include_levels is None:
        include_levels = ["critical", "important"]

    allowed_types = set()
    for level in include_levels:
        allowed_types.update(PRIORITY.get(level, []))

    return [e for e in events if e.get("type") in allowed_types]
