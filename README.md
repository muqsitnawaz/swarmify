# Swarmify

True multi-agent coding in your IDE. Run Claude, Codex, Gemini, and Cursor agents side-by-side with your code.

```
+------------------+     +------------------+     +------------------+
|   Claude Code    |     |      Codex       |     |      Gemini      |
+--------+---------+     +--------+---------+     +--------+---------+
         |                        |                        |
         +------------------------+------------------------+
                                  |
                    +-------------+-------------+
                    |     Swarmify MCP Server   |
                    |   (Agent Orchestration)   |
                    +-------------+-------------+
                                  |
                    +-------------+-------------+
                    |    VS Code / Cursor IDE   |
                    |  (Extension: Editor Tabs) |
                    +---------------------------+
```

## Why Swarmify?

**The Problem:** Different AI coding agents excel at different tasks. Claude is great for research. Codex is fast and surgical. Gemini handles complex multi-system changes. But switching between them means copy-pasting context and losing flow.

**The Solution:** Swarmify lets agents orchestrate each other. Claude can spawn Codex for a quick fix while continuing its analysis. Your IDE becomes a control center where agents run as editor tabs, not hidden terminals.

**Harness Engineering:** This is context engineering for multi-agent workflows. Each agent gets exactly the context it needs, nothing more. No token waste, no confusion.

## Packages

| Package | Description | Install |
| --- | --- | --- |
| [@swarmify/agents-mcp](./mcp-server) | MCP server for spawning agents | `npx @swarmify/agents-mcp` |
| [Agents Extension](./extension) | VS Code/Cursor extension | [Marketplace](https://marketplace.visualstudio.com/items?itemName=swarmify.swarm-ext) |
| [Prompts](./prompts) | Slash commands for all agents | See below |

## Quick Start

### MCP Server (for Claude Code, Gemini CLI, OpenCode)

```bash
# Claude Code
claude mcp add swarmify-agents -- npx -y @swarmify/agents-mcp

# Gemini CLI
gemini mcp add swarmify-agents -- npx -y @swarmify/agents-mcp

# OpenCode
opencode mcp add
# Name: swarmify-agents
# Command: npx -y @swarmify/agents-mcp
```

### VS Code Extension

Install "Agents" from the VS Code Marketplace, or search for `swarmify.swarm-ext`.

## How It Works

**The Extension** turns your IDE into an agent control center. Each agent runs as an editor tab (not the bottom panel), so you can see your code and agents side-by-side.

**The MCP Server** lets any MCP-compatible agent spawn other agents. Claude can spawn Codex for a quick task. Gemini can spawn Claude for deeper analysis. Agents coordinate without you copy-pasting between terminals.

## Features

### Agent Modes

- **Plan Mode** (default): Read-only for research and exploration
- **Edit Mode**: Full write access for implementation
- **Ralph Mode**: Autonomous task execution

### Ralph Mode

Ralph mode spawns an agent that autonomously works through a checklist of tasks in a `RALPH.md` file, marking them complete as it progresses. The agent understands the full system context and picks tasks in a logical order. Perfect for multi-step feature builds or large refactors.

**RALPH.md format:**

```markdown
## [ ] Task title

Task description

### Updates

---

## [x] Completed task

Task description

### Updates
- Progress note 1
- Progress note 2
```

See [@swarmify/agents-mcp README](./mcp-server/README.md#ralph-mode) for complete documentation.

## Prompts

Slash commands calibrated for each agent. Install via the extension or manually copy from `./prompts`.

| Command | Description |
| --- | --- |
| `/recap` | Facts + grounded hypotheses for handoff |
| `/srecap` | Agents investigate gaps before handoff |
| `/plan` | Create a concise implementation plan |
| `/splan` | Sprint-sized plan with parallel steps |
| `/debug` | Diagnose root cause before fixing |
| `/sdebug` | Parallelize the debugging investigation |
| `/clean` | Refactor safely for clarity |
| `/sclean` | Parallel agents tackle different areas |
| `/test` | Plan critical path tests first |
| `/stest` | Parallel agents test different paths |
| `/ship` | Pre-launch verification |
| `/sship` | Independent agents confirm readiness |
| `/sconfirm` | Agents confirm analysis without bias |
| `/swarm` | Distribute tasks across parallel agents |

Commands prefixed with `s` spawn multiple agents for parallel verification.

## Supported Agents

| Agent | CLI | Best For |
| --- | --- | --- |
| Claude Code | `claude` | Maximum capability, research, exploration |
| Codex | `codex` | Fast, cheap. Self-contained features |
| Gemini | `gemini` | Complex multi-system features |
| Cursor | `cursor-agent` | Debugging, bug fixes |

## Development

```bash
# MCP Server
cd mcp-server && bun install && bun run build

# Extension
cd extension && bun install && bun run compile
```

## Examples

See [examples/](./examples) for working demos and workflow patterns.

## Website

[swarmify.co](https://swarmify.co) - Landing page with interactive demos.

## License

MIT
