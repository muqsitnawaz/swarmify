# Agent Swarm MCP Server

Give your AI coding agent the ability to spawn, orchestrate, and manage other AI agents.

This is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that exposes tools for spawning separate terminal-based AI agents (like Claude Code, Codex, Gemini CLI, etc.) to handle sub-tasks.

## Features

- **Spawn Agents**: Create new agent instances for specific tasks (e.g., "fix bug in auth", "refactor api").
- **Orchestration**: Manage multiple agents running in parallel.
- **Safety Modes**:
  - `plan` (default): Read-only mode for research and exploration.
  - `edit`: Write access enabled for implementation tasks.
- **Agent Support**: Designed to work with CLI tools like `claude`, `cursor-agent`, `codex`, and `gemini`.

## Installation

You can run this server directly using `bunx`:

```bash
bunx agent-swarm
```

## Configuration

### Environment Variables

- `AGENT_SWARM_PREFERENCE`: Comma-separated list of agent types to prefer (default: `cursor,codex,claude,gemini`).
- `AGENT_SWARM_DEFAULT_MODE`: Set default safety mode (`plan` or `edit`).

### Prerequisites

This server orchestrates *other* CLI tools. You must have the relevant agent CLIs installed and available in your system `PATH`:

- `claude` (Claude Code)
- `codex` (OpenAI CLI)
- `gemini` (Google Gemini CLI)
- `cursor-agent` (Cursor CLI)

## Usage with Claude Desktop

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "swarm": {
      "command": "bunx",
      "args": ["-y", "agent-swarm"],
      "env": {
        "AGENT_SWARM_DEFAULT_MODE": "plan"
      }
    }
  }
}
```

---

### Built by [Novier Aurex](https://novieraurex.com)

We build **Rush** — AI teammates for startups.
If you like this low-level orchestration tool, you'll love our dedicated macOS app that gives you a full AI team (Content Writer, Revenue Analyst, Deep Researcher) that works while you sleep.

