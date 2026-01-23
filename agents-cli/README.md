# @swarmify/agents-cli

Dotfiles manager for AI coding agents. Sync skills, MCP servers, and CLI versions across machines.

Part of the [Swarmify](https://github.com/muqsitnawaz/swarmify) multi-agent toolkit.

## Install

```bash
npm install -g @swarmify/agents-cli
```

## Quick Start

```bash
# See what's installed
agents status

# Sync from your .agents repo
agents pull gh:username/.agents

# Or use a local directory
agents pull ~/dotfiles/.agents
```

## Commands

### Status & Sync

| Command | Description |
|---------|-------------|
| `agents status` | Show CLIs, skills, sync source |
| `agents pull <source>` | Pull and install from repo |
| `agents push` | Export local config to repo |
| `agents sync <source>` | Alias for pull |

### Skills

| Command | Description |
|---------|-------------|
| `agents skills list` | List installed skills |
| `agents skills list --agent claude` | Filter by agent |
| `agents skills add gh:user/skills` | Install from git repo |
| `agents skills remove <name>` | Uninstall skill |

### MCP Servers

| Command | Description |
|---------|-------------|
| `agents mcp list` | Show registration status |
| `agents mcp add <name> <command>` | Add to manifest |
| `agents mcp remove <name>` | Unregister from agents |
| `agents mcp register` | Register all from manifest |

### CLI Management

| Command | Description |
|---------|-------------|
| `agents cli list` | Show versions and paths |
| `agents cli add <agent>` | Add to manifest |
| `agents cli remove <agent>` | Remove from manifest |
| `agents cli upgrade` | Upgrade all to manifest versions |
| `agents cli upgrade --latest` | Upgrade to latest |

## Repo Structure

Your `.agents` repo should look like:

```
.agents/
  agents.yaml           # Manifest with CLIs, MCP, defaults
  shared/
    commands/           # Skills shared across all agents
  claude/
    commands/           # Claude-specific skills
    hooks/              # Claude hooks
  codex/
    prompts/            # Codex-specific skills
  gemini/
    prompts/            # Gemini skills (TOML format)
```

## Manifest Format

```yaml
clis:
  claude:
    package: "@anthropic-ai/claude-code"
    version: "2.0.65"
  codex:
    package: "@openai/codex"
    version: "0.88.0"

mcp:
  swarm:
    command: "npx @swarmify/agents-mcp"
    transport: stdio
    scope: user
    agents: [claude, codex]

defaults:
  method: symlink
  scope: global
  agents: [claude, codex, gemini]
```

## Supported Agents

| Agent | CLI | Config Directory |
|-------|-----|------------------|
| Claude | `claude` | `~/.claude/` |
| Codex | `codex` | `~/.codex/` |
| Gemini | `gemini` | `~/.gemini/` |
| Cursor | `cursor-agent` | `~/.cursor-agent/` |
| OpenCode | `opencode` | `~/.opencode/` |
| Trae | `trae-cli` | `~/.trae/` |

## Options

| Flag | Description |
|------|-------------|
| `-y, --yes` | Skip interactive prompts |
| `-f, --force` | Force overwrite |
| `--dry-run` | Preview changes |
| `--skip-mcp` | Skip MCP registration |

## State

Local state is stored in `~/.agents/`:

```
~/.agents/
  state.json    # Sync state, last sync time
  repos/        # Cloned .agents repos
  packages/     # External skill packages
```

## Related Packages

| Package | Description |
|---------|-------------|
| [@swarmify/agents-mcp](https://www.npmjs.com/package/@swarmify/agents-mcp) | MCP server for multi-agent orchestration. Spawn Claude, Codex, Gemini agents in parallel. |

## License

MIT
