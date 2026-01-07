# @swarmify/agents-mcp

**Run subagents from any MCP client.**

Your AI agent searches files, reads code, explores patterns—and all that fills its context window. Around 40% full, it starts getting dumber. By 80%, it's making mistakes.

This MCP server lets you spawn subagents that work in their own context. They do the heavy lifting. Your main agent stays sharp.

## What You Get

1. **MCP Server** - Adds `spawn`, `status`, `stop`, `tasks` tools to any MCP-compatible agent
2. **The /swarm command** - Pre-built command that teaches your AI how to coordinate work ([see swarm.md](https://github.com/muqsitnawaz/.agents/blob/main/claude/commands/swarm.md))

## How It Works

```
You: /swarm Implement user authentication with JWT

Orchestrator:
├── Shows distribution plan (which agents do what)
├── Defines boundary contracts (no stepping on each other)
├── Gets your approval
├── Spawns 3 subagents in parallel
│   ├── Gemini: JWT token handling
│   ├── Codex: Auth middleware
│   └── Cursor: Login/logout endpoints
├── Monitors progress
└── Validates + runs tests
```

Each subagent works in its OWN context window. Your orchestrator stays lean.

## Under the Hood

**Headless CLI agents.** We spawn Claude Code, Codex, and Gemini CLIs as background processes—no interactive prompts, just work. Output streams to `~/.swarmify/agents/{id}/stdout.log`.

**Plan vs edit modes.** Plan mode is read-only:
- Claude: `--permission-mode plan`
- Codex: sandboxed (no `--full-auto`)
- Gemini/Cursor: no auto-approve flags

Edit mode unlocks writes—Codex gets `--full-auto`, Claude gets `acceptEdits`, Gemini gets `--yolo`, Cursor gets `-f`.

**Agents survive restarts.** Processes are detached from the MCP server. Close your IDE, reopen it—agents are still running. The server picks them back up from disk.

## Why This Matters

- **Keep your main agent responsive** - Subagents prevent context bloat
- **Work in parallel** - Multiple agents, one task
- **Fully private** - Tasks stored locally in `~/.swarmify/`
- **Any agent type** - Claude, Codex, Gemini, Cursor - use the right tool for the job

## Quick Start

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

The server auto-discovers which agent CLIs you have installed.

## Optional: Visual Control

Install the [agents-ext](https://marketplace.visualstudio.com/items?itemName=swarmify.agents-ext) VS Code extension to monitor your agents live:

- Agents as editor tabs (not separate windows)
- Quick-spawn with keyboard shortcuts
- Track all running tasks in one view

Works with Cursor, VS Code, and any VS Code-based IDE.

---

## API Reference

### Tools

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
| `effort` | No | `fast`, `default` (implicit), or `detailed` for max-capability models |

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
| Claude | `claude` | Best for complex research and open-ended exploration |
| Codex | `codex` | Fast, cheap. Self-contained features |
| Gemini | `gemini` | Complex multi-system features, architectural changes |
| Cursor | `cursor-agent` | Debugging, bug fixes, tracing through codebases |

## Modes

| Mode | File Access | Use Case |
|------|-------------|----------|
| `plan` | Read-only | Research, exploration, code review |
| `edit` | Read + Write | Implementation, refactoring, fixes |

Default is `plan` for safety. Pass `mode='edit'` when agents need to modify files.

## Effort Levels

| Level | Models Used |
|-------|-------------|
| `fast` | codex: gpt-5.2-codex, claude: claude-haiku-4-5, gemini: gemini-3-flash, cursor: composer-1 |
| `default` | codex: gpt-5.2-codex, claude: claude-sonnet-4-5, gemini: gemini-3-flash, cursor: composer-1 |
| `detailed` | codex: gpt-5.1-codex-max, claude: claude-opus-4-5, gemini: gemini-3-pro, cursor: composer-1 |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGENT_SWARM_DEFAULT_MODE` | Set default mode (`plan` or `edit`) |

## Storage

Data and config are stored under `~/.swarmify/`. Requires Node.js >= 18.17.

## License

MIT
