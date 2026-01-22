# Swarmify

Turn your IDE into an agentic IDE. Run Claude, Codex, Gemini, and Cursor as full-screen terminals alongside your code.

## Is this for you?

- You use Claude Code, Codex, Gemini, or Cursor CLI agents
- You're tired of agents buried in the bottom terminal panel
- You want agents that can spawn sub-agents for parallel work

## The idea

A single coding agent is like a junior developer. Capable, but handles one thing at a time.

With Swarm MCP, your agent becomes a **tech lead**. It understands the full task, breaks it into pieces, spawns sub-agents for each piece, gives them project context, and makes sure they run tests. You talk to one agent; it manages a team.

The **extension** makes you an engineering manager with multiple tech leads. Full-screen terminals instead of tiny tmux panes. Keyboard shortcuts to jump between agents instantly. Labels to remember who's working on what. Like Vim for agent sessions.

Some communities call this **harness engineering** - infrastructure that lets agents coordinate without you copy-pasting context between them.

## How it works

Open Claude as a full-screen terminal tab. Ask it to implement a feature. Claude figures out it needs auth, database changes, and API updates - spawns Codex for the API, Gemini for the database, handles auth itself. Each sub-agent gets specific files, clear scope, and project context. Claude synthesizes the results.

You manage one conversation. Claude manages the team.

Sub-agents run as background processes. They use your existing CLI installations and your API keys - Swarmify just coordinates them.

## What it costs

Swarmify is free and open source.

Each agent uses your own API keys (Claude = Anthropic, Codex = OpenAI, Gemini = Google). Spawning 3 Claude sub-agents means 3x your normal Claude API cost. No hidden fees, no Swarmify subscription.

## Packages

| Package | Description | Install |
| --- | --- | --- |
| [@swarmify/agents-mcp](./agents-mcp) | MCP server for spawning sub-agents | `npx @swarmify/agents-mcp` |
| [Extension](./extension) | VS Code/Cursor extension | [Marketplace](https://marketplace.visualstudio.com/items?itemName=swarmify.swarm-ext) |
| [Prompts](./prompts) | Slash commands for all agents | Copy from `./prompts` |

## Quick Start

### 1. Install the extension

Search "Agents" in VS Code/Cursor marketplace, or install `swarmify.swarm-ext`.

### 2. Add Swarm MCP to your agent

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

### 3. Open an agent and start working

Press `Cmd+Shift+A` to spawn Claude as a full-screen terminal tab. Use `/swarm` to have it orchestrate sub-agents:

```
/swarm Implement user authentication with JWT tokens
```

## Example Workflows

**Multi-agent debugging:**
```
/sdebug The API returns 500 errors intermittently on /users endpoint
```
Spawns 2-3 agents to investigate in parallel, then synthesizes findings.

**Parallel feature implementation:**
```
/swarm Add dark mode support:
- Agent 1: Update theme context and CSS variables
- Agent 2: Add toggle component to settings
- Agent 3: Persist preference to localStorage
```

**Code review with verification:**
```
/sconfirm Review the changes in the last 3 commits for security issues
```

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd+Shift+A` | Spawn new agent |
| `Cmd+Shift+L` | Label agent by task |
| `Cmd+Shift+C` | Clear and restart agent |
| `Cmd+Shift+D` | Open Dashboard |
| `Cmd+Shift+G` | Generate git commit |

## Supported Agents

| Agent | CLI | Best For |
| --- | --- | --- |
| Claude Code | `claude` | Complex research, orchestration |
| Codex | `codex` | Fast implementation, self-contained features |
| Gemini | `gemini` | Multi-system changes, architecture |
| Cursor | `cursor-agent` | Debugging, tracing through codebases |

## Prompts

Slash commands calibrated for each agent. Commands prefixed with `s` spawn multiple agents for parallel work.

| Command | Description |
| --- | --- |
| `/plan` | Design implementation approach |
| `/splan` | Parallel agents validate the plan |
| `/debug` | Root cause analysis |
| `/sdebug` | Parallel investigation |
| `/test` | Write critical path tests |
| `/stest` | Parallel agents test different paths |
| `/clean` | Remove tech debt |
| `/sclean` | Parallel cleanup across areas |
| `/ship` | Pre-launch verification |
| `/sship` | Independent agents confirm readiness |
| `/swarm` | Multi-agent orchestration |

## Agent Modes

| Mode | File Access | Use Case |
| --- | --- | --- |
| `plan` | Read-only | Research, exploration, code review |
| `edit` | Read + Write | Implementation, refactoring |
| `ralph` | Full access + auto-loop | Autonomous task execution via RALPH.md |

See [@swarmify/agents-mcp](./agents-mcp) for mode details and Ralph documentation.

## Requirements

- VS Code or Cursor
- At least one agent CLI installed (`claude`, `codex`, `gemini`, or `cursor-agent`)
- API keys configured for your agents

## Development

```bash
# MCP Server
cd agents-mcp && bun install && bun run build

# Extension
cd extension && bun install && bun run compile
```

## License

MIT
