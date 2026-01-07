![Swarmify](https://swarmify.co/logo.png)

# Swarmify

True multi-agent coding in your IDE. Run Claude, Codex, Gemini, and Cursor agents side-by-side with your code.

## Packages

| Package | Description | Install |
| --- | --- | --- |
| [@swarmify/agents-mcp](./agents-mcp) | MCP server for spawning agents | `npx @swarmify/agents-mcp` |
| [Agents Extension](./agents-ext) | VS Code/Cursor extension | [Marketplace](https://marketplace.visualstudio.com/items?itemName=swarmify.agents-ext) |
| [Website](./agents-web) | swarmify.co | \- |

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

Install "Agents" from the VS Code Marketplace, or search for `swarmify.agents-ext`.

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

See [@swarmify/agents-mcp README](./agents-mcp/README.md#ralph-mode) for complete documentation.

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
cd agents-mcp && bun install && bun run build

# Extension
cd agents-ext && bun install && bun run compile

# Website
cd agents-web && bun install && bun run dev
```

## License

MIT
