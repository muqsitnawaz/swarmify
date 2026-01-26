# Swarmify

[![Extension](https://img.shields.io/visual-studio-marketplace/v/swarmify.swarm-ext?label=Extension&color=blue)](https://marketplace.visualstudio.com/items?itemName=swarmify.swarm-ext)
[![MCP Server](https://img.shields.io/npm/v/@swarmify/agents-mcp?label=MCP%20Server&color=green)](https://www.npmjs.com/package/@swarmify/agents-mcp)
[![CLI](https://img.shields.io/npm/v/@swarmify/agents-cli?label=CLI&color=orange)](https://www.npmjs.com/package/@swarmify/agents-cli)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](./LICENSE)

You don't need a coding agent. You need a team.

[Homepage](https://swarmify.co) | [Agents Extension](https://marketplace.visualstudio.com/items?itemName=swarmify.swarm-ext) | [Agents MCP](https://www.npmjs.com/package/@swarmify/agents-mcp) | [Agents CLI](https://www.npmjs.com/package/@swarmify/agents-cli)

Turn your IDE into an agentic IDE. Run Claude, Codex, Gemini, and Cursor as full-screen terminals orchestrated through `/swarm` with approvals before execution.

## Is this for you?

- You use Claude Code, Codex, Gemini, or Cursor CLI agents
- You want a **Mix of Agents** on every task, not a single model guess
- You want approvals before code runs, and agents that can spawn agents for parallel work

## Quick Start

1) Install the extension: search "Agents" in VS Code/Cursor marketplace (`swarmify.swarm-ext`).
2) Add Swarm MCP to your agent CLI:

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

3) Run `/swarm` with your task and desired mix, then approve the plan:

```
/swarm Ship billing polish — 70% Claude planning, 30% Codex coding
```

The lead agent proposes a plan and **Mix of Agents**; you review and approve before anything executes.

## How Swarms Work

| Step | What happens |
| --- | --- |
| 1 | Run `/swarm "your task description with mix needs"` |
| 2 | Lead agent creates a distribution plan and assembles the **Mix of Agents** |
| 3 | You review and approve; the swarm executes only after approval |

## Mix of Agents Explained

- Describe needs in the task description; the orchestrator builds the **Mix of Agents** automatically.
- Examples: "70% Gemini research-heavy", "60% Codex coding", "50/50 Cursor/Codex debugging".
- Diversity prevents blind spots and ensures coverage across planning, coding, debugging, and verification.

## Agents Can Spawn Agents

Hierarchical orchestration: a lead agent can spawn children, and those children can spawn grandchildren when tasks expand. Teams grow with complexity—for example, Claude (lead) spawns Codex for implementation, Gemini for systems analysis, and Cursor for debugging.

## For Teams

- Shared orchestration with session restoration so work survives IDE restarts
- Approval gates and auditability across every `/swarm` run
- No new infrastructure—uses your existing agent CLIs and API keys

## Department-Level Transformation

Ship a feature overnight: the PM writes a task, `/swarm` proposes a plan plus **Mix of Agents**, you approve, and specialized agents ship and verify in parallel. Benefits: speed (parallel execution), coverage (model diversity), and governance (approvals with audit trail).

## How it works

Open an agent tab, run `/swarm`, get a plan + **Mix of Agents**, approve, and let the hierarchy execute. One conversation; the lead manages the team.

## What it costs

Swarmify is free and open source.

Each agent uses your own API keys (Claude = Anthropic, Codex = OpenAI, Gemini = Google). Spawning 3 Claude sub-agents means 3x your normal Claude API cost. No hidden fees, no Swarmify subscription.

## Packages

| Package | Description | Install |
| --- | --- | --- |
| [@swarmify/agents-mcp](./agents-mcp) | MCP server for spawning sub-agents | `npx @swarmify/agents-mcp` |
| [Extension](./extension) | VS Code/Cursor extension | [Marketplace](https://marketplace.visualstudio.com/items?itemName=swarmify.swarm-ext) |
| [Prompts](./prompts) | Slash commands for all agents | Copy from `./prompts` |

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

**Specify the mix up front:**
```
/swarm Migrate billing to Stripe Checkout — 70% Claude planning, 30% Codex coding
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
