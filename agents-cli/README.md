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
| `agents status` | Show installed CLIs, skills (user/project), MCP servers (user/project) |
| `agents pull <source>` | Pull and install from GitHub or local dir |
| `agents push` | Export config to .agents repo |

Options: `-y` (skip prompts), `-f` (force), `--dry-run` (preview)

### Skills (Commands/Prompts)

| Command | Description |
|---------|-------------|
| `agents skills list` | List installed skills with user/project scope |
| `agents skills list --scope user` | List only user-scoped skills |
| `agents skills list --scope project` | List only project-scoped skills |
| `agents skills add <source>` | Install from git repo or local path |
| `agents skills remove <name>` | Uninstall skill |
| `agents skills push <name>` | Copy project-scoped skill to user scope |

### MCP Servers

| Command | Description |
|---------|-------------|
| `agents mcp list` | Show MCP servers with user/project scope |
| `agents mcp list --scope user` | List only user-scoped MCPs |
| `agents mcp list --scope project` | List only project-scoped MCPs |
| `agents mcp add <name> <cmd>` | Add and register across agents |
| `agents mcp remove <name>` | Unregister from all agents |
| `agents mcp push <name>` | Copy project-scoped MCP to user scope |

### CLI Management

| Command | Description |
|---------|-------------|
| `agents cli list` | Show versions and install paths |
| `agents cli upgrade` | Upgrade to manifest versions |
| `agents cli upgrade --latest` | Upgrade to latest |

## Scopes

Skills and MCP servers can be installed at two scopes:

| Scope | Location | Applies To |
|-------|----------|------------|
| User | `~/.{agent}/` | All projects |
| Project | `./.{agent}/` | Current project only |

When you run `agents status` or `agents skills list` in a directory, it shows both user-scoped and project-scoped items. Project-scoped items are defined in `.claude/commands/`, `.codex/prompts/`, etc. within the current directory.

Use `agents skills push <name>` or `agents mcp push <name>` to copy a project-scoped item to user scope so it's available everywhere.

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
