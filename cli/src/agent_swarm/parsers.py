"""JSON output parsers for different CLI agents.

Each CLI has a different output format. This module normalizes them to a common schema.

Common event types (normalized):
- init: Agent started
- thinking: Agent reasoning (delta or complete)
- tool_use: Tool was called
- file_write: File was written/modified
- file_read: File was read
- bash: Bash command executed
- message: Agent message (delta or complete)
- result: Final result
- error: Error occurred
- raw: Unparsed output
"""

from datetime import datetime
from typing import Literal

AgentType = Literal["codex", "gemini", "cursor", "claude"]


def normalize_events(agent_type: AgentType, raw: dict) -> list[dict]:
    """Normalize an event from any agent to a list of common-schema events."""
    if agent_type == "codex":
        return _normalize_codex(raw)
    elif agent_type == "cursor":
        return _normalize_cursor(raw)
    elif agent_type == "gemini":
        return _normalize_gemini(raw)
    elif agent_type == "claude":
        return _normalize_claude(raw)

    timestamp = datetime.now().isoformat()
    return [{
        "type": raw.get("type", "unknown"),
        "agent": agent_type,
        "raw": raw,
        "timestamp": timestamp,
    }]


def normalize_event(agent_type: AgentType, raw: dict) -> dict:
    """Normalize an event and return the first normalized entry.

    Consumers that need multiple derived events (e.g., multiple tool_use blocks)
    should call `normalize_events` instead.
    """
    events = normalize_events(agent_type, raw)
    if events:
        return events[0]

    return {
        "type": raw.get("type", "unknown"),
        "agent": agent_type,
        "raw": raw,
        "timestamp": datetime.now().isoformat(),
    }


def _normalize_codex(raw: dict) -> list[dict]:
    """
    Normalize Codex CLI output.

    Codex events:
    - thread.started: {"type": "thread.started", "thread_id": "..."}
    - turn.started: {"type": "turn.started"}
    - item.completed: {"type": "item.completed", "item": {"type": "agent_message|tool_call", ...}}
    - turn.completed: {"type": "turn.completed", "usage": {...}}
    """
    event_type = raw.get("type", "unknown")
    timestamp = datetime.now().isoformat()

    if event_type == "thread.started":
        return [{
            "type": "init",
            "agent": "codex",
            "session_id": raw.get("thread_id"),
            "timestamp": timestamp,
        }]

    elif event_type == "turn.started":
        return [{
            "type": "turn_start",
            "agent": "codex",
            "timestamp": timestamp,
        }]

    elif event_type == "item.completed":
        item = raw.get("item", {})
        item_type = item.get("type")

        if item_type == "agent_message":
            return [{
                "type": "message",
                "agent": "codex",
                "content": item.get("text", ""),
                "complete": True,
                "timestamp": timestamp,
            }]

        elif item_type == "command_execution":
            # Codex runs shell commands via command_execution
            command = item.get("command", "")
            return [{
                "type": "bash",
                "agent": "codex",
                "tool": "command_execution",
                "command": command,
                "timestamp": timestamp,
            }]

        elif item_type == "tool_call":
            tool_name = item.get("name", "unknown")
            tool_args = item.get("arguments", {})

            # Detect file operations
            if tool_name in ("write_file", "create_file", "edit_file"):
                return [{
                    "type": "file_write",
                    "agent": "codex",
                    "tool": tool_name,
                    "path": tool_args.get("path", tool_args.get("file_path", "")),
                    "timestamp": timestamp,
                }]
            elif tool_name in ("read_file",):
                return [{
                    "type": "file_read",
                    "agent": "codex",
                    "tool": tool_name,
                    "path": tool_args.get("path", tool_args.get("file_path", "")),
                    "timestamp": timestamp,
                }]
            elif tool_name in ("shell", "bash", "execute"):
                return [{
                    "type": "bash",
                    "agent": "codex",
                    "tool": tool_name,
                    "command": tool_args.get("command", ""),
                    "timestamp": timestamp,
                }]
            else:
                return [{
                    "type": "tool_use",
                    "agent": "codex",
                    "tool": tool_name,
                    "args": tool_args,
                    "timestamp": timestamp,
                }]

    elif event_type == "turn.completed":
        usage = raw.get("usage", {})
        return [{
            "type": "result",
            "agent": "codex",
            "status": "success",
            "usage": {
                "input_tokens": usage.get("input_tokens", 0),
                "output_tokens": usage.get("output_tokens", 0),
            },
            "timestamp": timestamp,
        }]

    # Default passthrough
    return [{
        "type": event_type,
        "agent": "codex",
        "raw": raw,
        "timestamp": timestamp,
    }]


def _normalize_cursor(raw: dict) -> list[dict]:
    """
    Normalize Cursor Agent CLI output.

    Cursor events:
    - system/init: {"type": "system", "subtype": "init", "model": "...", "session_id": "..."}
    - user: {"type": "user", "message": {...}}
    - thinking: {"type": "thinking", "subtype": "delta|complete", "text": "..."}
    - assistant: {"type": "assistant", "message": {...}}
    - result: {"type": "result", "subtype": "success|error", "duration_ms": ...}
    """
    event_type = raw.get("type", "unknown")
    subtype = raw.get("subtype")
    timestamp = datetime.now().isoformat()

    if event_type == "system" and subtype == "init":
        return [{
            "type": "init",
            "agent": "cursor",
            "model": raw.get("model"),
            "session_id": raw.get("session_id"),
            "timestamp": timestamp,
        }]

    elif event_type == "thinking":
        return [{
            "type": "thinking",
            "agent": "cursor",
            "content": raw.get("text", ""),
            "complete": subtype == "complete",
            "timestamp": timestamp,
        }]

    elif event_type == "assistant":
        message = raw.get("message", {})
        content_blocks = message.get("content", [])
        events = []
        text_content = ""

        # Process all content blocks - create separate events for each tool_use
        for block in content_blocks:
            if block.get("type") == "text":
                text_content += block.get("text", "")
            elif block.get("type") == "tool_use":
                # Create a separate event for each tool_use block
                events.append({
                    "type": "tool_use",
                    "agent": "cursor",
                    "tool": block.get("name", "unknown"),
                    "args": block.get("input", {}),
                    "timestamp": timestamp,
                })

        # If there's text content and no tool_use blocks, or text comes after tool_use,
        # create a message event. If we already have tool_use events, we still create
        # a message event if there's text content.
        if text_content:
            events.append({
                "type": "message",
                "agent": "cursor",
                "content": text_content,
                "complete": True,
                "timestamp": timestamp,
            })

        # If no events were created (empty content blocks), return a message event anyway
        if not events:
            events.append({
                "type": "message",
                "agent": "cursor",
                "content": "",
                "complete": True,
                "timestamp": timestamp,
            })

        return events

    elif event_type == "result":
        return [{
            "type": "result",
            "agent": "cursor",
            "status": subtype or "success",
            "duration_ms": raw.get("duration_ms"),
            "timestamp": timestamp,
        }]

    elif event_type == "tool_result":
        return [{
            "type": "tool_result",
            "agent": "cursor",
            "tool": raw.get("tool_name", "unknown"),
            "success": raw.get("success", True),
            "timestamp": timestamp,
        }]

    # Default passthrough
    return [{
        "type": event_type,
        "agent": "cursor",
        "raw": raw,
        "timestamp": timestamp,
    }]


def _normalize_gemini(raw: dict) -> list[dict]:
    """
    Normalize Gemini CLI output.

    Gemini events:
    - init: {"type": "init", "timestamp": "...", "session_id": "...", "model": "..."}
    - message: {"type": "message", "role": "user|assistant", "content": "...", "delta": true|false}
    - result: {"type": "result", "status": "success|error", "stats": {...}}
    """
    event_type = raw.get("type", "unknown")
    timestamp = raw.get("timestamp", datetime.now().isoformat())

    if event_type == "init":
        return [{
            "type": "init",
            "agent": "gemini",
            "model": raw.get("model"),
            "session_id": raw.get("session_id"),
            "timestamp": timestamp,
        }]

    elif event_type == "message":
        role = raw.get("role", "assistant")
        if role == "assistant":
            return [{
                "type": "message",
                "agent": "gemini",
                "content": raw.get("content", ""),
                "complete": not raw.get("delta", False),
                "timestamp": timestamp,
            }]
        else:
            return [{
                "type": "user_message",
                "agent": "gemini",
                "content": raw.get("content", ""),
                "timestamp": timestamp,
            }]

    elif event_type in ("tool_call", "tool_use"):
        # Gemini uses tool_name/parameters, others use name/args
        tool_name_raw = raw.get("tool_name") or raw.get("name") or "unknown"
        tool_name = str(tool_name_raw)

        tool_args_raw = raw.get("parameters")
        if tool_args_raw is None:
            tool_args_raw = raw.get("args")
        tool_args = tool_args_raw if isinstance(tool_args_raw, dict) else {}
        tool_name_lower = tool_name.lower()

        # Detect file operations (handle both path and file_path keys)
        file_path = tool_args.get("file_path", tool_args.get("path", ""))

        if "write" in tool_name_lower and "file" in tool_name_lower:
            return [{
                "type": "file_write",
                "agent": "gemini",
                "tool": tool_name,
                "path": file_path,
                "timestamp": timestamp,
            }]
        elif "read" in tool_name_lower and "file" in tool_name_lower:
            return [{
                "type": "file_read",
                "agent": "gemini",
                "tool": tool_name,
                "path": file_path,
                "timestamp": timestamp,
            }]
        elif tool_name_lower in ("shell", "bash", "execute", "run_command"):
            return [{
                "type": "bash",
                "agent": "gemini",
                "tool": tool_name,
                "command": tool_args.get("command", ""),
                "timestamp": timestamp,
            }]

        return [{
            "type": "tool_use",
            "agent": "gemini",
            "tool": tool_name,
            "args": tool_args,
            "timestamp": timestamp,
        }]

    elif event_type == "result":
        stats = raw.get("stats", {})
        return [{
            "type": "result",
            "agent": "gemini",
            "status": raw.get("status", "success"),
            "duration_ms": stats.get("duration_ms"),
            "usage": {
                "total_tokens": stats.get("total_tokens", 0),
            },
            "timestamp": timestamp,
        }]

    # Default passthrough
    return [{
        "type": event_type,
        "agent": "gemini",
        "raw": raw,
        "timestamp": timestamp,
    }]


def _normalize_claude(raw: dict) -> list[dict]:
    """
    Normalize Claude Code CLI output.

    Similar to Cursor format (both use Anthropic's format).
    """
    # Claude Code uses similar format to Cursor
    events = _normalize_cursor(raw)

    # _normalize_cursor returns a list; mirror that but ensure agent is set correctly.
    for event in events:
        event["agent"] = "claude"
    return events


def parse_event(agent_type: AgentType, line: str) -> list[dict] | None:
    """Parse a single line of output into normalized events."""
    import json

    try:
        raw = json.loads(line)
        return normalize_events(agent_type, raw)
    except json.JSONDecodeError:
        return None
