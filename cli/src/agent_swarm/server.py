"""MCP server for spawning and orchestrating AI coding agents."""

import asyncio
import json
from datetime import datetime, timedelta
from typing import Literal

from loguru import logger
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

from .agents import AgentManager, AgentStatus, AgentType, check_all_clis, resolve_mode_flags
from .summarizer import summarize_events, get_delta

# Global agent manager
manager = AgentManager()

# Create MCP server
server = Server("agent-swarm")


def _get_agent_mode(agent) -> str:
    """Return agent mode string with backward-compatible fallback."""
    return getattr(agent, "mode", "yolo" if getattr(agent, "yolo", False) else "safe")


def _resolve_mode(requested_mode: str | None, requested_yolo: bool | None) -> tuple[str, bool]:
    """Resolve the requested mode/yolo flags into a canonical mode + bool."""
    default_mode = getattr(manager, "default_mode", "safe")
    return resolve_mode_flags(requested_mode, requested_yolo, default_mode)


@server.list_tools()
async def list_tools() -> list[Tool]:
    """List available tools."""
    return [
        Tool(
            name="spawn_agent",
            description="""Spawn an AI coding agent to work on a task asynchronously.

Agent selection guide (choose automatically - don't ask the user):
- codex: Self-contained features, clean implementations, straightforward tasks with clear specs. Fast and cheap. Use for most feature work.
- cursor: Debugging, bug fixes, investigating issues in existing code. Good at tracing through codebases and fixing broken things.
- gemini: Complex features involving multiple subsystems, architectural changes, or tasks requiring coordination across many files.
- claude: General purpose fallback, research, exploration, or when you need maximum capability.

Default to codex for feature implementation. Use cursor for bugs. Use gemini for complex multi-system work.""",
            inputSchema={
                "type": "object",
                "properties": {
                    "agent_type": {
                        "type": "string",
                        "enum": ["codex", "gemini", "cursor", "claude"],
                        "description": "Type of agent to spawn",
                    },
                    "prompt": {
                        "type": "string",
                        "description": "The task/prompt for the agent",
                    },
                    "cwd": {
                        "type": "string",
                        "description": "Working directory for the agent (optional)",
                    },
                    "mode": {
                        "type": "string",
                        "enum": ["safe", "yolo"],
                        "description": "Preferred automation mode. 'yolo' swaps --full-auto for --yolo where supported (unsafe).",
                    },
                    "yolo": {
                        "type": "boolean",
                        "description": "Enable unsafe yolo mode (replaces --full-auto with --yolo when supported)",
                        "default": False,
                    },
                },
                "required": ["agent_type", "prompt"],
            },
        ),
        Tool(
            name="read_agent_output",
            description="""Read output from a running or completed agent.

IMPORTANT: Always prefer summary format with brief/standard detail to minimize token usage.
- format='summary' + detail_level='brief': Use this by default. Minimal tokens, shows status and key info.
- format='summary' + detail_level='standard': Use when you need more context about what the agent did.
- format='delta': Use for polling a running agent - only returns new events since last read.
- format='events' or detail_level='detailed': ONLY use when debugging failures or need raw output. Very token-heavy.

For most use cases, just call with agent_id only - defaults are optimized for efficiency.""",
            inputSchema={
                "type": "object",
                "properties": {
                    "agent_id": {
                        "type": "string",
                        "description": "ID of the agent to read output from",
                    },
                    "format": {
                        "type": "string",
                        "enum": ["summary", "delta", "events"],
                        "default": "summary",
                        "description": "Output format. Prefer 'summary' (default) for token efficiency. Use 'delta' for polling. Avoid 'events' unless debugging.",
                    },
                    "detail_level": {
                        "type": "string",
                        "enum": ["brief", "standard", "detailed"],
                        "default": "brief",
                        "description": "Detail level for summary format. Default is 'brief' (~80 tokens) for efficiency. Use 'standard' (~200 tokens) for more context. Only use 'detailed' (~500 tokens) when debugging failures.",
                    },
                    "since_event": {
                        "type": "integer",
                        "default": 0,
                        "description": "Return events after this index (for delta/events format)",
                    },
                },
                "required": ["agent_id"],
            },
        ),
        Tool(
            name="list_agents",
            description="List all agents (running and completed) with their status",
            inputSchema={
                "type": "object",
                "properties": {},
            },
        ),
        Tool(
            name="stop_agent",
            description="Stop a running agent",
            inputSchema={
                "type": "object",
                "properties": {
                    "agent_id": {
                        "type": "string",
                        "description": "ID of the agent to stop",
                    },
                },
                "required": ["agent_id"],
            },
        ),
        Tool(
            name="check_environment",
            description="Check which CLI agents are installed and available. Call this before spawning agents to verify the environment is ready.",
            inputSchema={
                "type": "object",
                "properties": {},
            },
        ),
        Tool(
            name="view_logs",
            description="View recent agent-swarm server logs for debugging. Shows server startup, agent spawns, errors, and shutdown events.",
            inputSchema={
                "type": "object",
                "properties": {
                    "lines": {
                        "type": "integer",
                        "description": "Number of recent log lines to return (default: 50, max: 500)",
                        "default": 50,
                    },
                    "level": {
                        "type": "string",
                        "enum": ["all", "info", "warning", "error"],
                        "description": "Filter by log level (default: all)",
                        "default": "all",
                    },
                },
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    """Handle tool calls."""
    import json

    try:
        if name == "spawn_agent":
            result = await handle_spawn_agent(
                agent_type=arguments["agent_type"],
                prompt=arguments["prompt"],
                cwd=arguments.get("cwd"),
                mode=arguments.get("mode"),
                yolo=arguments.get("yolo"),
            )

        elif name == "read_agent_output":
            result = await handle_read_agent_output(
                agent_id=arguments["agent_id"],
                format=arguments.get("format", "summary"),
                detail_level=arguments.get("detail_level", "standard"),
                since_event=arguments.get("since_event", 0),
            )

        elif name == "list_agents":
            result = await handle_list_agents()

        elif name == "stop_agent":
            result = await handle_stop_agent(agent_id=arguments["agent_id"])

        elif name == "check_environment":
            result = await handle_check_environment()

        elif name == "view_logs":
            result = await handle_view_logs(
                lines=arguments.get("lines", 50),
                level=arguments.get("level", "all"),
            )

        else:
            result = {"error": f"Unknown tool: {name}"}

        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    except Exception as e:
        logger.exception(f"Error in tool {name}")
        return [TextContent(type="text", text=json.dumps({"error": str(e)}))]


async def handle_spawn_agent(
    agent_type: AgentType,
    prompt: str,
    cwd: str | None = None,
    mode: Literal["safe", "yolo"] | None = None,
    yolo: bool | None = None,
) -> dict:
    """Spawn a new agent."""
    resolved_mode, resolved_yolo = _resolve_mode(mode, yolo)
    agent = await manager.spawn(agent_type, prompt, cwd, yolo=resolved_yolo, mode=resolved_mode)

    response_mode = _get_agent_mode(agent) or resolved_mode
    return {
        "agent_id": agent.agent_id,
        "agent_type": agent.agent_type,
        "status": agent.status.value,
        "started_at": agent.started_at.isoformat(),
        "mode": response_mode,
        "yolo": agent.yolo,
        "message": f"Spawned {agent_type} agent to work on task ({'YOLO' if response_mode == 'yolo' else 'safe'} mode)",
    }


async def handle_read_agent_output(
    agent_id: str,
    format: Literal["summary", "delta", "events"] = "summary",
    detail_level: Literal["brief", "standard", "detailed"] = "brief",
    since_event: int = 0,
) -> dict:
    """Read agent output in specified format."""
    agent = manager.get(agent_id)

    if not agent:
        return {"error": f"Agent {agent_id} not found"}

    mode = _get_agent_mode(agent)
    yolo_enabled = agent.yolo

    if format == "summary":
        summary = summarize_events(
            agent_id=agent.agent_id,
            agent_type=agent.agent_type,
            status=agent.status.value,
            events=agent.events,
            duration=agent._duration(),
        )
        return {
            **summary.to_dict(detail_level),
            "mode": mode,
            "yolo": yolo_enabled,
        }

    elif format == "delta":
        delta = get_delta(
            agent_id=agent.agent_id,
            agent_type=agent.agent_type,
            status=agent.status.value,
            events=agent.events,
            since_event=since_event,
        )
        return {
            **delta,
            "mode": mode,
            "yolo": yolo_enabled,
        }

    else:  # events
        from .summarizer import PRIORITY
        
        all_events = agent.events[since_event:]
        
        # Filter out verbose events to reduce tokens
        # Keep critical and important events, but filter incomplete thinking/message deltas
        critical_types = set(PRIORITY.get("critical", []))
        important_types = set(PRIORITY.get("important", []))
        verbose_types = set(PRIORITY.get("verbose", []))
        
        filtered_events = []
        for event in all_events:
            event_type = event.get("type", "")
            
            # Skip verbose event types
            if event_type in verbose_types:
                continue
            
            # For thinking/message events, only include complete ones (not deltas)
            if event_type in ("thinking", "message"):
                if not event.get("complete", False):
                    continue
            
            # Include critical and important events
            if event_type in critical_types or event_type in important_types:
                filtered_events.append(event)
        
        # Truncate long content in remaining events (but preserve full messages)
        optimized_events = []
        for event in filtered_events:
            event_copy = event.copy()
            event_type = event.get("type", "")
            
            # Truncate thinking content (verbose), but keep full messages (important)
            if "content" in event_copy and isinstance(event_copy["content"], str):
                if event_type == "thinking":
                    # Truncate thinking content to reduce tokens
                    max_len = 200
                    if len(event_copy["content"]) > max_len:
                        event_copy["content"] = event_copy["content"][:max_len - 3] + "..."
                # Don't truncate message content - these are important and should be shown in full
            
            # Truncate long command fields
            if "command" in event_copy and isinstance(event_copy["command"], str):
                if len(event_copy["command"]) > 300:
                    event_copy["command"] = event_copy["command"][:297] + "..."
            
            # Remove verbose raw data (keep structure but not full raw payload)
            if "raw" in event_copy and event_type != "raw":
                raw_data = event_copy["raw"]
                if isinstance(raw_data, dict) and len(str(raw_data)) > 500:
                    event_copy["raw"] = {"_truncated": True, "_size": len(str(raw_data))}
            
            optimized_events.append(event_copy)
        
        return {
            "agent_id": agent.agent_id,
            "agent_type": agent.agent_type,
            "status": agent.status.value,
            "since_event": since_event,
            "event_count": len(agent.events),
            "filtered_event_count": len(optimized_events),
            "events": optimized_events,
            "mode": mode,
            "yolo": yolo_enabled,
        }


async def handle_list_agents() -> dict:
    """List agents with smart filtering (running + recent completions)."""
    all_agents = manager.list_all()

    # Filter: running OR completed within last hour
    cutoff = datetime.now() - timedelta(hours=1)
    relevant = [
        a for a in all_agents
        if a.status == AgentStatus.RUNNING
        or (a.completed_at and a.completed_at > cutoff)
    ]

    running = [a for a in relevant if a.status == AgentStatus.RUNNING]
    completed = [a for a in relevant if a.status != AgentStatus.RUNNING]

    return {
        "agents": [a.to_dict() for a in relevant],
        "running_count": len(running),
        "completed_count": len(completed),
        "filtered": len(all_agents) - len(relevant),
    }


async def handle_stop_agent(agent_id: str) -> dict:
    """Stop a running agent."""
    success = await manager.stop(agent_id)

    if success:
        return {
            "agent_id": agent_id,
            "status": "stopped",
            "message": f"Agent {agent_id} has been stopped",
        }
    else:
        agent = manager.get(agent_id)
        if agent:
            return {
                "agent_id": agent_id,
                "status": agent.status.value,
                "message": f"Agent {agent_id} was not running (status: {agent.status.value})",
            }
        return {"error": f"Agent {agent_id} not found"}


async def handle_check_environment() -> dict:
    """Check which CLI agents are installed and available."""
    agents = check_all_clis()

    installed = [name for name, info in agents.items() if info["installed"]]
    missing = [name for name, info in agents.items() if not info["installed"]]

    return {
        "agents": agents,
        "installed": installed,
        "missing": missing,
        "ready": len(missing) == 0,
        "message": (
            "All CLI agents are installed and ready."
            if len(missing) == 0
            else f"Missing CLI tools: {', '.join(missing)}. Install them to use these agent types."
        ),
    }


async def handle_watch_agent(
    agent_id: str,
    since_event: int = 0,
    include_raw: bool = False,
) -> dict:
    """Watch agent output in real-time - returns new events since last call."""
    agent = manager.get(agent_id)

    if not agent:
        return {"error": f"Agent {agent_id} not found"}

    # Force refresh to get latest events from file
    agent._read_new_events()

    all_events = agent.events
    new_events = all_events[since_event:]

    # Get raw events from stdout file if requested
    raw_events = []
    if include_raw and agent.stdout_path.exists():
        try:
            with open(agent.stdout_path, "r") as f:
                lines = f.readlines()
                # Get lines after the ones we've already processed
                # This is approximate - we track by event count, not line count
                if since_event < len(lines):
                    raw_lines = lines[since_event:]
                    for line in raw_lines:
                        line = line.strip()
                        if line:
                            try:
                                raw_events.append(json.loads(line))
                            except json.JSONDecodeError:
                                pass
        except Exception as e:
            logger.debug(f"Error reading raw events: {e}")

    # Format events for display (preserve full messages)
    formatted_events = []
    for event in new_events:
        event_copy = event.copy()
        event_type = event.get("type", "")
        
        # Only truncate thinking content, preserve messages
        if "content" in event_copy and isinstance(event_copy["content"], str):
            if event_type == "thinking" and len(event_copy["content"]) > 200:
                event_copy["content"] = event_copy["content"][:197] + "..."
        
        formatted_events.append(event_copy)

    return {
        "agent_id": agent_id,
        "agent_type": agent.agent_type,
        "status": agent.status.value,
        "since_event": since_event,
        "current_event_count": len(all_events),
        "new_event_count": len(new_events),
        "events": formatted_events,
        "raw_events": raw_events if include_raw else None,
        "has_more": agent.status == AgentStatus.RUNNING,
    }


async def handle_view_logs(lines: int = 50, level: str = "all") -> dict:
    """View recent server logs for debugging."""
    from .agents import AGENTS_DIR

    log_file = AGENTS_DIR.parent / "agent-swarm.log"

    if not log_file.exists():
        return {
            "error": "Log file not found",
            "path": str(log_file),
        }

    # Clamp lines to reasonable range
    lines = max(1, min(lines, 500))

    # Read the log file
    try:
        with open(log_file, "r") as f:
            all_lines = f.readlines()
    except Exception as e:
        return {"error": f"Failed to read log file: {e}"}

    # Filter by level if requested
    level_filters = {
        "info": ["INFO", "WARNING", "ERROR"],
        "warning": ["WARNING", "ERROR"],
        "error": ["ERROR"],
        "all": None,
    }

    filter_levels = level_filters.get(level)
    if filter_levels:
        all_lines = [
            line for line in all_lines
            if any(f" | {lvl}" in line for lvl in filter_levels)
        ]

    # Get the last N lines
    recent_lines = all_lines[-lines:]

    return {
        "log_path": str(log_file),
        "total_lines": len(all_lines),
        "returned_lines": len(recent_lines),
        "level_filter": level,
        "logs": "".join(recent_lines),
    }


def main():
    """Run the MCP server."""
    import atexit
    import signal
    import sys

    from .agents import AGENTS_DIR

    # Configure loguru to write to stderr AND file for debugging
    logger.remove()
    logger.add(sys.stderr, level="INFO")

    # Add file logging for debugging using the same writable base as agent storage
    log_dir = AGENTS_DIR.parent
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        log_file = log_dir / "agent-swarm.log"
        logger.add(log_file, level="DEBUG", rotation="10 MB", retention="3 days")
    except Exception as exc:  # pragma: no cover - defensive fallback
        logger.warning(f"File logging disabled (path not writable: {log_dir}): {exc}")

    # Log shutdown reasons for debugging
    def log_exit():
        logger.debug("MCP server exiting (atexit handler)")

    def signal_handler(signum, frame):
        sig_name = signal.Signals(signum).name
        logger.warning(f"MCP server received signal {sig_name} ({signum})")
        sys.exit(128 + signum)

    atexit.register(log_exit)
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    # SIGPIPE can cause silent exits when the parent closes the pipe
    signal.signal(signal.SIGPIPE, signal.SIG_IGN)

    logger.info("Starting agent-swarm MCP server")

    async def run():
        try:
            async with stdio_server() as (read_stream, write_stream):
                logger.debug("MCP stdio connection established")
                await server.run(read_stream, write_stream, server.create_initialization_options())
                logger.debug("MCP server.run() returned normally")
        except Exception as e:
            logger.exception(f"MCP server crashed: {e}")
            raise

    try:
        asyncio.run(run())
        logger.debug("asyncio.run() completed normally")
    except KeyboardInterrupt:
        logger.info("MCP server interrupted by keyboard")
    except Exception as e:
        logger.exception(f"Fatal error in agent-swarm: {e}")


if __name__ == "__main__":
    main()
