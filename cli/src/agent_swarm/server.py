"""MCP server for spawning and orchestrating AI coding agents."""

import asyncio
from datetime import datetime, timedelta
from typing import Literal

from loguru import logger
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

from .agents import AgentManager, AgentStatus, AgentType, check_all_clis
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
    if requested_mode is not None:
        normalized = requested_mode.lower()
        if normalized not in ("safe", "yolo"):
            raise ValueError(f"Invalid mode '{requested_mode}'. Use 'safe' or 'yolo'.")
        return normalized, normalized == "yolo"

    resolved_yolo = bool(requested_yolo)
    return ("yolo" if resolved_yolo else "safe", resolved_yolo)


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
                        "default": "standard",
                        "description": "Detail level for summary format. Prefer 'brief' or 'standard'. Only use 'detailed' when debugging failures.",
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
    agent = await manager.spawn(agent_type, prompt, cwd, yolo=resolved_yolo)

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
    detail_level: Literal["brief", "standard", "detailed"] = "standard",
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
            duration_ms=agent._duration_ms(),
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
        events = agent.events[since_event:]
        return {
            "agent_id": agent.agent_id,
            "agent_type": agent.agent_type,
            "status": agent.status.value,
            "since_event": since_event,
            "event_count": len(agent.events),
            "events": events,
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


def main():
    """Run the MCP server."""
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

    logger.info("Starting agent-swarm MCP server")

    async def run():
        try:
            async with stdio_server() as (read_stream, write_stream):
                await server.run(read_stream, write_stream, server.create_initialization_options())
        except Exception as e:
            logger.exception(f"MCP server crashed: {e}")
            raise

    try:
        asyncio.run(run())
    except Exception as e:
        logger.exception(f"Fatal error in agent-swarm: {e}")


if __name__ == "__main__":
    main()
