"""MCP server for spawning and orchestrating AI coding agents."""

import asyncio
from typing import Literal

from loguru import logger
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

from .agents import AgentManager, AgentStatus, AgentType
from .summarizer import summarize_events, get_delta

# Global agent manager
manager = AgentManager()

# Create MCP server
server = Server("agent-spawner")


@server.list_tools()
async def list_tools() -> list[Tool]:
    """List available tools."""
    return [
        Tool(
            name="spawn_agent",
            description="Spawn an AI coding agent (codex, gemini, cursor, claude) to work on a task asynchronously",
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
                },
                "required": ["agent_type", "prompt"],
            },
        ),
        Tool(
            name="read_agent_output",
            description="Read output from a running or completed agent. Use format='summary' (default) for token-efficient summaries, 'delta' for changes since last read, or 'events' for raw events.",
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
                        "description": "Output format: summary (compressed), delta (changes only), events (raw)",
                    },
                    "detail_level": {
                        "type": "string",
                        "enum": ["brief", "standard", "detailed"],
                        "default": "standard",
                        "description": "Detail level for summary format",
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
) -> dict:
    """Spawn a new agent."""
    agent = await manager.spawn(agent_type, prompt, cwd)

    return {
        "agent_id": agent.agent_id,
        "agent_type": agent.agent_type,
        "status": agent.status.value,
        "started_at": agent.started_at.isoformat(),
        "message": f"Spawned {agent_type} agent to work on task",
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

    if format == "summary":
        summary = summarize_events(
            agent_id=agent.agent_id,
            agent_type=agent.agent_type,
            status=agent.status.value,
            events=agent.events,
            duration_ms=agent._duration_ms(),
        )
        return summary.to_dict(detail_level)

    elif format == "delta":
        return get_delta(
            agent_id=agent.agent_id,
            agent_type=agent.agent_type,
            status=agent.status.value,
            events=agent.events,
            since_event=since_event,
        )

    else:  # events
        events = agent.events[since_event:]
        return {
            "agent_id": agent.agent_id,
            "agent_type": agent.agent_type,
            "status": agent.status.value,
            "since_event": since_event,
            "event_count": len(agent.events),
            "events": events,
        }


async def handle_list_agents() -> dict:
    """List all agents."""
    agents = manager.list_all()
    running = [a for a in agents if a.status == AgentStatus.RUNNING]
    completed = [a for a in agents if a.status != AgentStatus.RUNNING]

    return {
        "agents": [a.to_dict() for a in agents],
        "running_count": len(running),
        "completed_count": len(completed),
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


def main():
    """Run the MCP server."""
    import sys

    # Configure loguru to write to stderr (stdout is for MCP protocol)
    logger.remove()
    logger.add(sys.stderr, level="INFO")

    logger.info("Starting agent-spawner MCP server")

    async def run():
        async with stdio_server() as (read_stream, write_stream):
            await server.run(read_stream, write_stream, server.create_initialization_options())

    asyncio.run(run())


if __name__ == "__main__":
    main()
