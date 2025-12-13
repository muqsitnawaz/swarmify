# agent-spawner

MCP server for spawning and orchestrating AI coding agents (Claude, Codex, Gemini, Cursor).

## Installation

```bash
uvx agent-spawner
```

## Usage

Add to Claude Code MCP config (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "agent-spawner": {
      "command": "uvx",
      "args": ["agent-spawner"]
    }
  }
}
```

## Tools

- `spawn_agent` - Spawn an AI agent to work on a task
- `read_agent_output` - Read output with summarization
- `list_agents` - List all agents
- `stop_agent` - Stop a running agent
