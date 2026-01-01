# @swarmify/agents-mcp

True multi-agent coding in your IDE. Spawn Claude, Codex, Gemini, and Cursor agents from a single MCP server.

This [Model Context Protocol](https://modelcontextprotocol.io/) server gives your AI coding agent the ability to spawn, orchestrate, and manage other AI agents. CLI-first, token-optimized, and works with any MCP-compatible host.

## Installation

```bash
# Claude Code
claude mcp add swarmify-agents -- npx -y @swarmify/agents-mcp

# Gemini CLI
gemini mcp add swarmify-agents -- npx -y @swarmify/agents-mcp

# OpenCode (interactive)
opencode mcp add
# Name: swarmify-agents
# Type: Local
# Command: npx -y @swarmify/agents-mcp
```

The server auto-discovers which agent CLIs you have installed and only exposes those in the `spawn` tool.

## Tools

| Tool | Description |
|------|-------------|
| `spawn` | Start an agent on a task. Returns immediately with agent ID. |
| `status` | Get agent progress: files changed, commands run, last messages. |
| `stop` | Stop one agent or all agents in a task. |
| `tasks` | List all tasks with their agents and activity. |

### spawn

```
spawn(task_name, agent_type, prompt, mode?, cwd?, effort?)
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `task_name` | Yes | Groups related agents (e.g., "auth-feature") |
| `agent_type` | Yes | `claude`, `codex`, `gemini`, or `cursor` |
| `prompt` | Yes | The task for the agent |
| `mode` | No | `plan` (read-only, default) or `edit` (can write files) |
| `cwd` | No | Working directory for the agent |
| `effort` | No | `medium` (default) or `high` for max-capability models |

### status

```
status(task_name, filter?)
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `task_name` | Yes | Task to check |
| `filter` | No | `running` (default), `completed`, `failed`, `stopped`, or `all` |

Returns files created/modified/read/deleted, bash commands executed, and last messages.

### stop

```
stop(task_name, agent_id?)
```

Stop all agents in a task, or a specific agent by ID.

### tasks

```
tasks(limit?)
```

List all tasks sorted by most recent activity.

## Token Optimization

This server is designed to minimize token usage for the calling agent:

| Optimization | Benefit |
|--------------|---------|
| Status defaults to `filter='running'` | Only shows active agents, not completed history |
| Bash commands truncated to 120 chars | Heredocs collapsed to `cat <<EOF > path` |
| Last 5 messages only | Not full conversation history |
| File operations deduplicated | Sets of created/modified/read/deleted paths |
| Spawn returns immediately | No blocking, poll with status later |

## Supported Agents

The server auto-discovers installed CLIs at startup:

| Agent | CLI | Best For |
|-------|-----|----------|
| Claude | `claude` | Maximum capability, research, exploration |
| Codex | `codex` | Fast, cheap. Self-contained features |
| Gemini | `gemini` | Complex multi-system features, architectural changes |
| Cursor | `cursor-agent` | Debugging, bug fixes, tracing through codebases |

Install the CLIs you want to use. The server reports available and missing agents on startup.

## Modes

| Mode | File Access | Use Case |
|------|-------------|----------|
| `plan` | Read-only | Research, exploration, code review |
| `edit` | Read + Write | Implementation, refactoring, fixes |

Default is `plan` for safety. Pass `mode='edit'` when agents need to modify files.

Data & config are stored under `~/.swarmify` (with a legacy fallback to `~/.agent-swarm`; if neither is writable, it falls back to your temp dir).

Requires Node.js >= 18.17 (ESM, fs.rm, etc.).

## Effort Levels

| Level | Models Used |
|-------|-------------|
| `medium` | Balanced models (default) |
| `high` | Max-capability models per agent |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGENT_SWARM_DEFAULT_MODE` | Set default mode (`plan` or `edit`) |

## License

MIT
