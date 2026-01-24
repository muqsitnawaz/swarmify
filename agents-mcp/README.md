# @swarmify/agents-mcp

Turn any agent into a tech lead. Spawn sub-agents from Claude, Codex, Gemini, or any MCP client.

Homepage: https://swarmify.co/#agents-mcp
NPM: https://www.npmjs.com/package/@swarmify/agents-mcp
VS Code Extension: [Agents](https://marketplace.visualstudio.com/items?itemName=swarmify.swarm-ext) - full-screen agent terminals in your editor

## What you get

A single agent handles one thing at a time - like a junior developer. Add this MCP server, and your agent becomes a tech lead: it can spawn sub-agents, assign them specific files, give them project context, and synthesize their results.

**4 tools:** `Spawn`, `Status`, `Stop`, `Tasks`
**3 modes:** `plan` (read-only), `edit` (can write), `ralph` (autonomous)
**Background processes:** Sub-agents run headless, survive IDE restarts

## Quick Start

```bash
# Claude Code
claude mcp add --scope user Swarm -- npx -y @swarmify/agents-mcp

# Codex
codex mcp add swarm -- npx -y @swarmify/agents-mcp@latest

# Gemini CLI
gemini mcp add Swarm -- npx -y @swarmify/agents-mcp

# OpenCode
opencode mcp add
# Name: Swarm, Command: npx -y @swarmify/agents-mcp
```

The server auto-discovers which agent CLIs you have installed.

## What it costs

This server is free and open source.

Each sub-agent uses your own API keys. Spawning 3 Claude agents means 3x your normal Claude API cost. No hidden fees.

## API Reference

### Spawn

```
Spawn(task_name, agent_type, prompt, mode?, cwd?, effort?)
```

Start an agent on a task. Returns immediately with agent ID.

| Parameter | Required | Description |
| --- | --- | --- |
| `task_name` | Yes | Groups related agents (e.g., "auth-feature") |
| `agent_type` | Yes | `claude`, `codex`, `gemini`, or `cursor` |
| `prompt` | Yes | The task for the agent |
| `mode` | No | `plan` (default), `edit`, or `ralph` |
| `cwd` | No | Working directory |
| `effort` | No | `fast`, `default`, or `detailed` |

### Status

```
Status(task_name, filter?, since?)
```

Get agent progress: files changed, commands run, last messages.

| Parameter | Required | Description |
| --- | --- | --- |
| `task_name` | Yes | Task to check |
| `filter` | No | `running` (default), `completed`, `failed`, `stopped`, `all` |
| `since` | No | ISO timestamp for delta updates |

### Stop

```
Stop(task_name, agent_id?)
```

Stop all agents in a task, or a specific agent by ID.

### Tasks

```
Tasks(limit?)
```

List all tasks sorted by most recent activity. Defaults to 10.

## Modes

| Mode | File Access | Auto-loop? | Use Case |
| --- | --- | --- | --- |
| `plan` | Read-only | No | Research, code review |
| `edit` | Read + Write | No | Implementation, fixes |
| `ralph` | Full | Yes | Autonomous via RALPH.md |

Default is `plan` for safety. Pass `mode='edit'` when agents need to modify files.

### Ralph Mode

Ralph mode spawns one agent with full permissions to autonomously work through tasks in a `RALPH.md` file. The agent reads the file, picks tasks logically, marks them complete, and continues until done.

```markdown
## [ ] Implement user authentication

Add JWT-based auth to the backend.

### Updates

---

## [x] Add rate limiting

Protect API endpoints.

### Updates
- Added sliding window counter
```

```
Spawn(mode='ralph', cwd='./my-project', prompt='Build the auth system')
```

## What This Server Does NOT Do

| Not This | That's The Orchestrator's Job |
|----------|-------------------------------|
| Scheduling | Decides when to spawn which agents |
| Task assignment | Writes prompts, defines what to do |
| Conflict resolution | Assigns non-overlapping files to agents |
| Intelligence | Pure infrastructure - no decision-making |

The server is a tool. Your orchestrating agent (Claude, etc.) decides how to use it.

## Supported Agents

| Agent | CLI | Best For |
| --- | --- | --- |
| Claude | `claude` | Complex research, orchestration |
| Codex | `codex` | Fast implementation |
| Gemini | `gemini` | Multi-system changes |
| Cursor | `cursor-agent` | Debugging, tracing |
| OpenCode | `opencode` | Provider-agnostic, open source |

## Under the Hood

Sub-agents run as detached background processes. Output streams to `~/.agents/agents/{id}/stdout.log`.

**Plan mode** is read-only:
- Claude: `--permission-mode plan`
- Codex: sandboxed
- Gemini/Cursor: no auto-approve

**Edit mode** unlocks writes:
- Claude: `acceptEdits`
- Codex: `--full-auto`
- Gemini: `--yolo`
- Cursor: `-f`

## Configuration

Config lives at `~/.agents/config.json`. See [AGENTS.md](./AGENTS.md) for full config reference.

## Environment Variables

| Variable | Description |
| --- | --- |
| `AGENTS_MCP_DEFAULT_MODE` | Default mode (`plan` or `edit`) |
| `AGENTS_MCP_RALPH_FILE` | Task file name (default: `RALPH.md`) |
| `AGENTS_MCP_DISABLE_RALPH` | Set `true` to disable ralph mode |

## Works great with the extension

This MCP server works standalone with any MCP client. For the best experience - full-screen agent terminals, session persistence, fast navigation - install the [Agents extension](https://marketplace.visualstudio.com/items?itemName=swarmify.swarm-ext) for VS Code/Cursor.

## Storage

Data at `~/.agents/`. Requires Node.js >= 18.17.

## License

MIT
