# @swarmify/agents-cli

Your virtual environment manager for AI coding agents.

Homepage: https://swarmify.co/#agents-cli
NPM: https://www.npmjs.com/package/@swarmify/agents-cli
VS Code Extension: [Agents](https://marketplace.visualstudio.com/items?itemName=swarmify.swarm-ext) - full-screen agent terminals with sub-agent spawning

```bash
npm install -g @swarmify/agents-cli
```

## The Problem

You spend hours configuring Claude Code: MCP servers, slash commands, hooks, skills. Then you switch to Codex or Gemini and start from scratch. Or you get a new machine and lose everything.

## The Solution

One command to configure all your agents.

```bash
# New machine? One command.
agents pull

# See what's installed
agents status
```

```
Agent CLIs

  Claude Code    2.0.65

Installed Commands

  Claude Code:
    User: clean, debug, plan, recap, ship, spawn, test, verify
    Project: eval

Installed Skills

  Claude Code:
    User: remotion-best-practices, vercel-react-best-practices

Installed MCP Servers

  Claude Code:
    User: Swarm@latest, GoDaddy
```

Your `.agents` repo becomes the source of truth for all your AI coding tools.

## What Gets Synced

| Resource | Description | Agents |
|----------|-------------|--------|
| Slash commands | `/debug`, `/plan`, custom prompts | Claude, Codex, Gemini, Cursor, OpenCode |
| MCP servers | Tools your agents can use | Claude, Codex, Gemini |
| Hooks | Pre/post execution scripts | Claude, Gemini |
| Skills | Reusable agent capabilities | Claude, Codex, Gemini |
| CLI versions | Which version of each agent | All |

## Quick Start

```bash
# 1. Install
npm install -g @swarmify/agents-cli

# 2. Pull (auto-configures from default repo on first run)
agents pull

# 3. Check what's installed
agents status
```

Pull a specific agent only:

```bash
agents pull claude    # Only configure Claude Code
agents pull codex     # Only configure Codex
```

## Using Your Own Config

By default, `agents pull` uses the [system repo](https://github.com/muqsitnawaz/.agents). To use your own:

```bash
# Fork the system repo, then:
agents repo add gh:username/.agents

# Now pull uses your repo
agents pull
```

## .agents Repo Structure

```
.agents/
  agents.yaml              # CLI versions, MCP servers, defaults
  shared/commands/         # Slash commands for all agents
  claude/commands/         # Claude-specific commands
  claude/hooks/            # Claude hooks
  codex/prompts/           # Codex-specific prompts
  gemini/commands/         # Gemini commands (auto-converted to TOML)
  skills/                  # Agent Skills (SKILL.md + rules/)
```

Example `agents.yaml`:

```yaml
clis:
  claude:
    package: "@anthropic-ai/claude-code"
    version: "latest"
  codex:
    package: "@openai/codex"
    version: "latest"

mcp:
  filesystem:
    command: "npx -y @anthropic-ai/mcp-filesystem"
    transport: stdio
    scope: user
    agents: [claude, codex, gemini]

  memory:
    command: "npx -y @anthropic-ai/mcp-memory"
    transport: stdio
    scope: user
    agents: [claude, codex, gemini]

defaults:
  method: symlink
  scope: user
  agents: [claude, codex, gemini]
```

## Commands

### Status

```bash
agents status              # Full overview
agents status --agent claude
```

### Pull & Push

```bash
agents pull                # Sync all agents from your repo
agents pull claude         # Sync only Claude resources
agents pull cc             # Same (aliases: cc, codex/cx, gemini/gx)
agents pull --dry-run      # Preview what would change
agents pull -y             # Auto-confirm, skip conflicts
agents pull -f             # Auto-confirm, overwrite conflicts
agents push                # Push local changes back
```

The pull command shows an overview of NEW vs EXISTING resources before installation. For conflicts, you're prompted per-resource to overwrite, skip, or cancel.

### Slash Commands

```bash
agents commands list
agents commands add gh:user/my-commands
agents commands remove my-command
agents commands push my-command   # Promote project -> user scope
```

### MCP Servers

```bash
# List across all agents
agents mcp list

# Add (use -- before the command)
agents mcp add memory -- npx -y @anthropic-ai/mcp-memory
agents mcp add api https://api.example.com --transport http

# Search registries
agents search filesystem
agents add mcp:@anthropic-ai/mcp-filesystem

# Remove
agents mcp remove memory
```

### Skills

```bash
agents skills list
agents skills add gh:user/my-skills
agents skills info my-skill
```

### Hooks

```bash
agents hooks list
agents hooks add gh:user/my-hooks
agents hooks remove my-hook
```

### CLI Management

```bash
agents cli list            # Show installed versions
agents cli add claude      # Install agent CLI
agents cli remove codex    # Uninstall agent CLI
agents cli upgrade         # Upgrade all to latest
```

## Scopes

Resources can exist at two levels:

| Scope | Location | Use |
|-------|----------|-----|
| User | `~/.{agent}/` | Available everywhere |
| Project | `./.{agent}/` | This repo only, committed |

Promote project-scoped items to user scope:

```bash
agents commands push my-command
agents mcp push my-server
agents skills push my-skill
```

## Filtering

All list commands support filters:

```bash
agents commands list --agent claude
agents mcp list --scope project
agents skills list --agent codex --scope user
```

## Registries

Search and install from public registries:

```bash
# Search
agents search github --type mcp

# Install from registry
agents add mcp:@anthropic-ai/mcp-filesystem

# Manage registries
agents registry list
agents registry add mcp myregistry https://api.example.com
agents registry config mcp myregistry --api-key KEY
```

## Supported Agents

| Agent | Commands | MCP | Hooks | Skills |
|-------|----------|-----|-------|--------|
| Claude Code | Yes | Yes | Yes | Yes |
| Codex | Yes | Yes | - | Yes |
| Gemini CLI | Yes | Yes | Yes | Yes |
| Cursor | Yes | Yes | - | - |
| OpenCode | Yes | Yes | - | - |

Format conversion is automatic. Write commands in markdown, they're converted to TOML for Gemini.

## Related

- [@swarmify/agents-mcp](https://www.npmjs.com/package/@swarmify/agents-mcp) - MCP server for sub-agent spawning
- [Agents Extension](https://marketplace.visualstudio.com/items?itemName=swarmify.swarm-ext) - Full-screen agent terminals in VS Code/Cursor

## License

MIT
