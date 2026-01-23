# agents

Unified CLI for AI coding agents. Manage commands, MCP servers, and CLI versions across Claude, Codex, Gemini, and more.

## Install

```bash
npm install -g @swarmify/agents-cli
```

## What It Does

| Capability | Description |
|------------|-------------|
| Commands | Install slash commands to all agents at once, auto-converts Markdown to TOML for Gemini |
| Skills | Install Agent Skills (SKILL.md + rules/) from repos like skills.sh |
| Hooks | Sync hooks and their data files across machines |
| MCP Servers | Register/unregister across Claude, Codex, Gemini in one command |
| CLI Versions | Pin versions, upgrade all, sync across machines |
| Sync | Push config to GitHub, pull on new machines |

## Quick Start

```bash
# See what's installed
agents status

# Install commands from any source
agents commands add gh:user/my-commands

# Register MCP servers
agents mcp add swarm "npx @swarmify/agents-mcp"

# Sync to new machine
agents pull gh:username/.agents
```

## Commands

### Status & Sync

| Command | Description |
|---------|-------------|
| `agents status` | Show installed CLIs, commands, hooks, MCP servers |
| `agents pull <source>` | Pull and install from GitHub or local dir |
| `agents push` | Export config to .agents repo |

Options: `-y` (skip prompts), `-f` (force), `--dry-run` (preview)

### Commands (Slash Commands)

| Command | Description |
|---------|-------------|
| `agents commands list` | List all installed commands |
| `agents commands add <source>` | Install from git repo or local path |
| `agents commands remove <name>` | Uninstall command |
| `agents commands push <name>` | Copy project-scoped command to user scope |

### Skills (Agent Skills)

Agent Skills are reusable capabilities (like from skills.sh) with SKILL.md and rules/ directory.

| Command | Description |
|---------|-------------|
| `agents skills list` | List all installed Agent Skills |
| `agents skills add <source>` | Install from git repo or local path |
| `agents skills remove <name>` | Uninstall skill from all agents |
| `agents skills push <name>` | Copy project-scoped skill to user scope |
| `agents skills info <name>` | Show skill metadata and rules |

### MCP Servers

| Command | Description |
|---------|-------------|
| `agents mcp list` | List all MCP servers |
| `agents mcp add <name> <cmd>` | Add and register across agents |
| `agents mcp remove <name>` | Unregister from all agents |
| `agents mcp push <name>` | Copy project-scoped MCP to user scope |

### Hooks

| Command | Description |
|---------|-------------|
| `agents hooks list` | List all installed hooks |
| `agents hooks add <source>` | Install from git repo or local path |
| `agents hooks remove <name>` | Uninstall hook |
| `agents hooks push <name>` | Copy project-scoped hook to user scope |

### CLI Management

| Command | Description |
|---------|-------------|
| `agents cli list` | Show versions and install paths |
| `agents cli upgrade` | Upgrade to manifest versions |
| `agents cli upgrade --latest` | Upgrade to latest |

## Filtering

All resource commands support filtering by agent and scope:

```bash
# Filter by agent
agents commands list --agent claude
agents skills list --agent codex
agents mcp list --agent codex

# Filter by scope
agents commands list --scope user
agents skills list --scope project
agents hooks list --scope project

# Combine filters
agents commands list --agent claude --scope user
```

## Scopes

Resources (commands, skills, MCP servers, hooks) can exist at two scopes:

| Scope | Location | Applies To |
|-------|----------|------------|
| User | `~/.{agent}/` | All projects |
| Project | `./.{agent}/` | Current project only |

Use `push` to copy a project-scoped item to user scope so it's available everywhere.

## Supported Agents

| Agent | CLI | Config | MCP | Hooks | Skills |
|-------|-----|--------|-----|-------|--------|
| Claude | `claude` | `~/.claude/` | Yes | Yes | Yes |
| Codex | `codex` | `~/.codex/` | Yes | - | Yes |
| Gemini | `gemini` | `~/.gemini/` | Yes | Yes | Yes |
| Cursor | `cursor-agent` | `~/.cursor-agent/` | - | - | - |
| OpenCode | `opencode` | `~/.opencode/` | - | - | - |
| Trae | `trae-cli` | `~/.trae/` | - | - | - |

## Repo Structure

Your `.agents` repo:

```
.agents/
  agents.yaml           # CLIs, MCP servers, defaults
  skills/               # Central storage for Agent Skills
    my-skill/
      SKILL.md
      rules/*.md
  shared/
    commands/           # Commands for all agents
    hooks/              # Hooks for all agents (+ data files)
  claude/
    commands/           # Claude-specific commands
    hooks/              # Claude-specific hooks
  gemini/
    prompts/            # Gemini commands (TOML format)
    hooks/              # Gemini-specific hooks
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
