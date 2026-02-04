# @swarmify/agents-cli

**One config for all your AI coding agents.** Sync CLIs, MCP servers, commands, hooks, and skills across Claude, Codex, Gemini, and Cursor.

[Homepage](https://swarmify.co/#agents-cli) | [NPM](https://www.npmjs.com/package/@swarmify/agents-cli) | [VS Code Extension](https://marketplace.visualstudio.com/items?itemName=swarmify.swarm-ext)

```bash
npm install -g @swarmify/agents-cli
```

## The Problem

Each agent stores config differently. Different paths, different formats:

| What | Claude | Codex | Gemini |
|------|--------|-------|--------|
| Commands | `~/.claude/commands/` (md) | `~/.codex/prompts/` (md) | `~/.gemini/commands/` (TOML) |
| MCP config | `~/.claude/settings.json` | `~/.codex/config.json` | `~/.gemini/settings.json` |
| Hooks | `~/.claude/hooks/` | - | `~/.gemini/hooks/` |

You spend hours configuring Claude Code - MCP servers, slash commands, hooks, skills. Then you switch to Codex and start from scratch. Get a new machine and lose everything.

## The Solution

```
                      .agents repo (GitHub)
                             |
            +----------------+----------------+
            |                |                |
      agents.yaml      commands/          hooks/
     (CLIs, MCPs)     (slash cmds)       (scripts)
            |                |                |
            +----------------+----------------+
                             |
                       agents pull
                             |
         +-------------------+-------------------+
         |                   |                   |
    ~/.claude/          ~/.codex/          ~/.gemini/
  - commands/ (md)    - prompts/ (md)    - commands/ (TOML)
  - hooks/            - config.json      - hooks/
  - settings.json                        - settings.json
```

One repo. One command. All agents configured.

```bash
# New machine? One command.
agents pull

# See what's installed
agents status
```

```
Agent CLIs

  Claude Code    2.0.65
  Codex          1.0.3
  Gemini CLI     0.1.15

Installed Commands

  Claude Code:   clean, debug, plan, ship, test
  Codex:         clean, debug, plan, ship, test
  Gemini CLI:    clean, debug, plan, ship, test

Installed MCP Servers

  All agents:    Swarm, filesystem, memory

Installed Hooks

  Claude Code:   pre-commit, post-tool
  Gemini CLI:    pre-commit, post-tool
```

Write commands once in markdown - auto-converts to TOML for Gemini. Define MCP servers once - installs to all agents. Your `.agents` repo becomes the single source of truth.

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

## Roadmap: Context Drives

Sync your docs, research, and chat history across machines and teams.

```
~/.agents/
  drives/                    # Context drives (synced)
    work/
      .context               # Per-drive settings
      docs/
      research/
      specs/
    personal/
      .context
      notes/

  sessions/                  # Agent chat history (synced)
    claude/
    codex/
    gemini/
```

**Why not just Google Drive?**

| Feature | Google Drive | Context Drives |
|---------|--------------|----------------|
| Sync files | Yes | Yes |
| Real-time collab | Yes (Docs only) | Yes (CRDT for all files) |
| Agent session sync | No | Yes |
| Checkpointing | No | Yes (snapshot & rollback) |
| Per-directory conflict strategy | No | Yes (`.context` file) |
| Designed for AI agents | No | Yes |

**Conflict resolution strategies** (configurable per directory):

```yaml
# .context file
strategy: crdt              # Auto-merge (like Google Docs)
# strategy: git             # Branch/PR/merge (for code)
# strategy: lock            # Exclusive access
# strategy: last-write-wins # Don't care about conflicts

sync: realtime              # or: on-demand, ignore
```

**Planned commands:**

```bash
agents drive create <name>
agents drive list
agents drive use <name>
agents drive sync
agents drive checkpoint "before refactor"
agents drive rollback <checkpoint>
```

**Multi-agent coordination:** When multiple agents (or developers) work on the same drive, the drive acts as a coordination layer - checkout files, see who's working on what, avoid conflicts.

## Related

- [@swarmify/agents-mcp](https://www.npmjs.com/package/@swarmify/agents-mcp) - MCP server for sub-agent spawning
- [Agents Extension](https://marketplace.visualstudio.com/items?itemName=swarmify.swarm-ext) - Full-screen agent terminals in VS Code/Cursor

## License

MIT
