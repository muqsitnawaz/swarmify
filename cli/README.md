# agent-swarm

Give your AI coding agent the ability to spawn other agents.

Install this in Claude Code and it can delegate tasks to Codex, Gemini, Cursor, or other Claude instances. Your primary agent becomes an orchestrator that breaks down complex work and farms it out to specialized workers running in parallel.

## Why

Large tasks benefit from parallelization. With agent-swarm, Claude Code can:

- **Delegate subtasks**: Spin up a Codex agent to write tests while Gemini documents the API
- **Get second opinions**: Have multiple agents review the same code independently
- **Run long tasks in background**: Spawn an agent and check back later for results
- **Save costs**: Summarized outputs reduce token usage by ~99% compared to raw transcripts

## Speed

Sequential task execution is slow. With agent-swarm, Claude Code can spawn multiple agents in parallel and continue working while they run in the background.

**Amdahl's Law** tells us: parallelize everything except what absolutely must be sequential. In practice:

- Spawn 3 agents to work on tests, docs, and implementation simultaneously
- Continue planning the next phase while agents work
- Check back periodically with delta reads
- Merge results when agents complete

A task that takes 30 minutes sequentially might complete in 10 minutes with parallel workers.

## Cost Efficiency

Agent transcripts can be massive (50k+ tokens). This MCP server provides APIs designed to minimize token usage:

- **Summary format**: Extracts only key info (files modified, errors, final message) - ~200 tokens instead of 50k
- **Delta reads**: Poll running agents for only new events since last check
- **Brief mode**: Ultra-compact ~80 token summaries for quick status checks
- **Smart filtering**: `list_agents()` returns only running + recent agents, not full history

## Smart Agent Selection

Different agents have different strengths. The orchestrator automatically picks the best tool for each job:

| Task Type | Agent | Why |
|-----------|-------|-----|
| New features | Codex | Fast, cheap, good at self-contained work |
| Bug fixes | Cursor | Excellent at tracing through existing code |
| Complex refactors | Gemini | Handles multi-file architectural changes |
| Research/exploration | Claude | Maximum capability when you need it |

No manual agent selection needed - just describe the task and let the orchestrator route it.

## Installation

```bash
uvx agent-swarm
```

Or install from PyPI:

```bash
pip install agent-swarm
```

## Requirements

Install the CLI tools for agents you want to use:

| Agent | Install | Docs |
|-------|---------|------|
| Claude Code | `npm install -g @anthropic-ai/claude-code` | [claude.ai/code](https://claude.ai/code) |
| Codex | `npm install -g @openai/codex` | [platform.openai.com](https://platform.openai.com/docs/codex) |
| Gemini | `npm install -g @anthropic-ai/gemini-cli` | [ai.google.dev](https://ai.google.dev/gemini-api/docs) |
| Cursor | `npm install -g cursor-agent` | [cursor.com](https://cursor.com/docs) |

## Setup

Add to your Claude Code config (`~/.claude.json`):

```json
{
  "mcpServers": {
    "Agent Swarm": {
      "command": "uvx",
      "args": ["agent-swarm"]
    }
  }
}
```

Restart Claude Code to load the server.

## Usage

Once configured, Claude Code can spawn and manage agents:

**Spawn a single agent:**
```
spawn_agent(agent_type="gemini", prompt="Summarize the README.md file")
```

**Run agents in parallel:**
```
spawn_agent(agent_type="codex", prompt="Write unit tests for auth.py")
spawn_agent(agent_type="claude", prompt="Review the API endpoints for security issues")
spawn_agent(agent_type="gemini", prompt="Document the database schema")
```

**Opt into YOLO mode (Codex only, unsafe):**
```
spawn_agent(agent_type="codex", prompt="Ship it", yolo=True)
# or
spawn_agent(agent_type="codex", prompt="Ship it", mode="yolo")
```
This swaps Codex's `--full-auto` flag for `--yolo`. It remains blocked by default and must be explicitly enabled.

**Check progress:**
```
read_agent_output(agent_id="abc123", format="summary")
```

**List all agents:**
```
list_agents()
```

## YOLO Mode (opt-in)

Safe automation (`--full-auto`) remains the default. To intentionally run Codex with the `--yolo` flag, opt in explicitly:

```
spawn_agent(agent_type="codex", prompt="deploy without safety rails", yolo=True)
```

YOLO mode swaps `--full-auto` for `--yolo` in the Codex command template; other agents keep their normal flags. Without `yolo=True`, any attempt to smuggle `--yolo` through the prompt is still rejected.
If you prefer a string-based option, `mode="yolo"` is equivalent and overrides the boolean if both are supplied.

## Output Formats

| Format | Use Case |
|--------|----------|
| `summary` | Token-efficient overview (default) |
| `delta` | Changes since last read (for polling) |
| `events` | Full JSON event stream (debugging only) |

Prefer `summary` format to minimize token usage. Only use `events` when debugging failures.

### Summary Detail Levels

| Level | Tokens | Contents |
|-------|--------|----------|
| `brief` | ~80 | Duration, tool count, last activity, files modified |
| `standard` | ~200 | + tools used, final message |
| `detailed` | ~500 | + all bash commands, warnings |

## Coordination Model

Multi-agent systems need coordination to prevent conflicts. There are two main approaches:

**Peer-to-peer (mailbox-based):** Agents communicate directly via message queues and claim file locks. Works well for autonomous agents without central oversight.

**Orchestrator-based (this project):** A primary agent delegates tasks and manages coordination. The orchestrator:
- Assigns different files/directories to each worker
- Serializes operations that might conflict
- Relays context between agents as needed
- Reads summaries and decides next steps

agent-swarm uses orchestrator-based coordination. Claude Code acts as the coordinator, spawning workers for specific tasks and synthesizing their outputs. This keeps the architecture simple - no message brokers, no lock servers, no agent identity management.

If you need decentralized agent-to-agent communication without an orchestrator, consider [Agent Mail MCP](https://github.com/Dicklesworthstone/mcp_agent_mail).

## How It Works

Agents run as detached background processes that:
- Continue working even if Claude Code disconnects
- Write output to `~/.claude/agent-swarm/agents/{id}/`
- Can be monitored across sessions
- Auto-cleanup after completion (keeps last 50)

`list_agents()` shows only running agents + those completed within the last hour.

## License

MIT
