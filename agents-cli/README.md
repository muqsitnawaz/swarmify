# agents

Unified CLI for AI coding agents. Manage commands, MCP servers, and CLI versions across Claude, Codex, Gemini, and more.

## Install

```bash
npm install -g @swarmify/agents-cli
```

## What It Does

| Capability | Description |
|------------|-------------|
| Commands | Install to all agents at once, auto-converts Markdown to TOML for Gemini |
| MCP Servers | Register/unregister across Claude, Codex, Gemini in one command |
| CLI Versions | Pin versions, upgrade all, sync across machines |
| Sync | Push config to GitHub, pull on new machines |

## Quick Start

```bash
# See what's installed
agents status

# Install commands from any source
agents skills add gh:user/my-commands

# Register MCP servers
agents mcp add swarm "npx @swarmify/agents-mcp"

# Sync to new machine
agents pull gh:username/.agents
```

## Commands

### Status & Sync

| Command | Description |
|---------|-------------|
| `agents status` | Show installed CLIs, commands, MCP servers |
| `agents pull <source>` | Pull and install from GitHub or local dir |
| `agents push` | Export config to .agents repo |

Options: `-y` (skip prompts), `-f` (force), `--dry-run` (preview)

### Commands

| Command | Description |
|---------|-------------|
| `agents skills list` | List installed commands |
| `agents skills add <source>` | Install from git repo or local path |
| `agents skills remove <name>` | Uninstall command |

### MCP Servers

| Command | Description |
|---------|-------------|
| `agents mcp list` | Show registration status per agent |
| `agents mcp add <name> <cmd>` | Add and register across agents |
| `agents mcp remove <name>` | Unregister from all agents |

### CLI Management

| Command | Description |
|---------|-------------|
| `agents cli list` | Show versions and install paths |
| `agents cli upgrade` | Upgrade to manifest versions |
| `agents cli upgrade --latest` | Upgrade to latest |

## Supported Agents

| Agent | CLI | Config | MCP |
|-------|-----|--------|-----|
| Claude | `claude` | `~/.claude/` | Yes |
| Codex | `codex` | `~/.codex/` | Yes |
| Gemini | `gemini` | `~/.gemini/` | Yes |
| Cursor | `cursor-agent` | `~/.cursor-agent/` | - |
| OpenCode | `opencode` | `~/.opencode/` | - |
| Trae | `trae-cli` | `~/.trae/` | - |

## Repo Structure

Your `.agents` repo:

```
.agents/
  agents.yaml           # CLIs, MCP servers, defaults
  shared/commands/      # Commands for all agents
  claude/commands/      # Claude-specific
  gemini/prompts/       # Gemini (TOML format)
```

## Manifest Format

```yaml
clis:
  claude:
    package: "@anthropic-ai/claude-code"
    version: "2.0.65"

mcp:
  swarm:
    command: "npx @swarmify/agents-mcp"
    agents: [claude, codex, gemini]

defaults:
  method: symlink
  agents: [claude, codex, gemini]
```

## State

Local state in `~/.agents/`:
- `state.json` - sync source, last sync time
- `repos/` - cloned .agents repos

## Related

- [@swarmify/agents-mcp](https://www.npmjs.com/package/@swarmify/agents-mcp) - MCP server for multi-agent orchestration

## License

MIT
