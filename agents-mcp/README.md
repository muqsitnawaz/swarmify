# @swarmify/agents-mcp

Run Subagents, Swarm or Ralph Wiggums from any MCP client.

Spawn CLI agents in parallel so your main agent stays focused. Each subagent runs in its own context and can be polled for progress.

## Why This Exists

MCP adoption is accelerating and the ecosystem is organizing around registries, gateways, and enterprise governance. At the same time, teams are pushing toward multi-agent workflows and running into orchestration reliability, tool overload, and security concerns. This server gives you a focused, practical building block for real-world swarm work.

The API surface is intentionally small, closer to iconic commands like `cd`, `ls`, and `git` than a framework. Fewer knobs means less room for an orchestrator to make mistakes.

## What You Get

- A dead simple MCP server with `Spawn`, `Status`, `Stop`, and `Tasks` tools
- The `/swarm` command to teach an orchestrator how to distribute work
- Plan vs edit modes that control file access per agent
- Local logs and durable processes that survive IDE restarts

## Quick Start

```bash
# Claude Code
claude mcp add --scope user Swarm -- npx -y @swarmify/agents-mcp

# Codex
codex mcp add swarm -- npx -y @swarmify/agents-mcp@latest

# Gemini CLI
gemini mcp add Swarm -- npx -y @swarmify/agents-mcp

# OpenCode (interactive)
opencode mcp add
# Name: swarmify-agents
# Type: Local
# Command: npx -y @swarmify/agents-mcp
```

The server auto-discovers which agent CLIs you have installed.

## Where It Fits

- Parallelize tasks across Claude, Codex, Gemini, and Cursor
- Keep long-running loops responsive by offloading work to subagents
- Integrate with MCP registries and gateways without changing your workflow
- Run Ralph Wiggum loops inside spawned Claude Code agents when the plugin is installed

## Under the Hood

Headless CLI agents run as background processes. Output streams to `~/.swarmify/agents/{id}/stdout.log`.

Plan mode is read-only:

- Claude: `--permission-mode plan`
- Codex: sandboxed (no `--full-auto`)
- Gemini and Cursor: no auto-approve flags

Edit mode unlocks writes:

- Codex: `--full-auto`
- Claude: `acceptEdits`
- Gemini: `--yolo`
- Cursor: `-f`

Agents are detached from the MCP server process. Close your IDE and reopen it, then reconnect with `Status` and `Tasks`.

## Common Questions

**"Isn't this overkill for simple tasks?**"Yes. For typo fixes or small changes, one agent is fine. But for implementing a complex feature across 20 files, a single agent drowning in context is slower than a focused swarm working in parallel.

**"What if agents conflict?**"They don't. The orchestrator (via `/swarm` command) assigns each agent specific files—no overlap. For shared files, it runs agents in sequential waves so there's no collision.

**"How do I monitor what's happening?**"Use the Swarm `Status` tool to see what each agent is doing: files changed, commands run, last messages. No black box—full visibility into the swarm.

## API Reference

### Tools

| Tool | Description |
| --- | --- |
| `Spawn` | Start an agent on a task. Returns immediately with agent ID. |
| `Status` | Get agent progress: files changed, commands run, last messages. |
| `Stop` | Stop one agent or all agents in a task. |
| `Tasks` | List all tasks with their agents and activity. |

### Spawn

```
Spawn(task_name, agent_type, prompt, mode?, cwd?, effort?)
```

| Parameter | Required | Description |
| --- | --- | --- |
| `task_name` | Yes | Groups related agents (e.g., "auth-feature") |
| `agent_type` | Yes | `claude`, `codex`, `gemini`, or `cursor` |
| `prompt` | Yes | The task for the agent |
| `mode` | No | `plan` (read-only, default), `edit` (can write files), or `ralph` (autonomous through RALPH.md) |
| `cwd` | No | Working directory for the agent |
| `effort` | No | `fast`, `default` (implicit), or `detailed` for max-capability models |

### Status

```
Status(task_name, filter?)
```

| Parameter | Required | Description |
| --- | --- | --- |
| `task_name` | Yes | Task to check |
| `filter` | No | `running` (default), `completed`, `failed`, `stopped`, or `all` |

Returns files created/modified/read/deleted, bash commands executed, and last messages.

### Stop

```
Stop(task_name, agent_id?)
```

Stop all agents in a task, or a specific agent by ID.

### Tasks

```
Tasks(limit?)
```

List all tasks sorted by most recent activity. Defaults to 10 tasks when limit is omitted.

## Token Optimization

This server is designed to minimize token usage for the calling agent:

| Optimization | Benefit |
| --- | --- |
| Status defaults to `filter='running'` | Only shows active agents, not completed history |
| Bash commands truncated to 120 chars | Heredocs collapsed to `cat <<EOF > path` |
| Last 5 messages only | Not full conversation history |
| File operations deduplicated | Sets of created/modified/read/deleted paths |
| Spawn returns immediately | No blocking, poll with Status later |

## Supported Agents

The server auto-discovers installed CLIs at startup:

| Agent | CLI | Best For |
| --- | --- | --- |
| Claude | `claude` | Best for complex research and open-ended exploration |
| Codex | `codex` | Fast, cheap. Self-contained features |
| Gemini | `gemini` | Complex multi-system features, architectural changes |
| Cursor | `cursor-agent` | Debugging, bug fixes, tracing through codebases |

## Modes

| Mode | File Access | Auto-loops? | Use Case |
| --- | --- | --- | --- |
| `plan` | Read-only | No | Research, exploration, code review |
| `edit` | Read + Write | No | Implementation, refactoring, fixes |
| `ralph` | Full yolo | Yes | Autonomous iteration through RALPH.md tasks |

Default is `plan` for safety. Pass `mode='edit'` when agents need to modify files.

### Ralph Mode

Ralph mode spawns ONE agent with full permissions and instructions to autonomously work through all tasks in a `RALPH.md` file.

**RALPH.md format:**

```markdown
## [ ] Implement user authentication

Add JWT-based auth to the backend API.

### Updates

---

## [x] Add rate limiting middleware

Protect API endpoints from abuse.

### Updates
- Added middleware with sliding window counter
- Completed: All endpoints protected

---

## [ ] Write integration tests

Cover auth endpoints.

### Updates
```

**How it works:**

1. Create a `RALPH.md` file in your project directory with tasks
2. Call `Spawn(mode='ralph', cwd='./my-project', prompt='Build the auth system')`
3. MCP spawns ONE agent with full permissions
4. Agent reads RALPH.md, understands the system, picks tasks logically
5. For each task: completes work, marks checkbox `## [x]`, adds update
6. Continues until all tasks checked (or you stop it with `Stop` tool)

**Multiple ralph agents:** You can spawn multiple ralph agents in parallel for different directories or different RALPH.md files. The orchestrator controls this.

**Safety:**

- Scoped by `cwd` - orchestrator controls blast radius
- RALPH.md must exist before spawn
- Warns if used in home/system directories
- Agent logs stored in `~/.swarmify/agents/{id}/stdout.log` like regular agents

## Effort Levels

| Level | Models Used |
| --- | --- |
| `fast` | codex: gpt-5.2-codex, claude: claude-haiku-4-5, gemini: gemini-3-flash, cursor: composer-1 |
| `default` | codex: gpt-5.2-codex, claude: claude-sonnet-4-5, gemini: gemini-3-flash, cursor: composer-1 |
| `detailed` | codex: gpt-5.1-codex-max, claude: claude-opus-4-5, gemini: gemini-3-pro, cursor: composer-1 |

## Environment Variables

| Variable | Description |
| --- | --- |
| `AGENT_SWARM_DEFAULT_MODE` | Set default mode (`plan` or `edit`) |
| `AGENTS_SWARM_RALPH_FILE` | Task file name for ralph mode (default: `RALPH.md`) |
| `AGENTS_SWARM_DISABLE_RALPH` | Set to `true` or `1` to disable ralph mode |

## Storage

Data and config are stored under `~/.swarmify/`. Requires Node.js &gt;= 18.17.

## Changelog

See `CHANGELOG.txt` for notable updates.

## License

MIT