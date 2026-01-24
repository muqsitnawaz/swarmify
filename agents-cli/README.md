# @swarmify/agents-cli

Dotfiles for AI coding agents. Sync prompts, MCP servers, hooks, and skills across Claude, Codex, Gemini, Cursor, and more.

```bash
npm install -g @swarmify/agents-cli
```

## The Idea

You configure Claude Code manually. Then you switch to Codex or Gemini and start from scratch. This CLI syncs your setup across all agents:

```bash
# See what you have installed
agents status

# Pull your config on a new machine
agents pull gh:username/.agents
```

## What Gets Synced

| Resource | Location | Synced To |
|----------|----------|-----------|
| Slash commands | `~/.claude/commands/` | Claude, Codex, Gemini |
| MCP servers | `~/.claude/settings.json` | Claude, Codex, Gemini |
| Hooks | `~/.claude/hooks.json` | Claude, Gemini |
| Agent Skills | `~/.claude/skills/` | Claude, Codex, Gemini |
| CLI versions | npm/brew | All agents |

## Commands

### Prompts (Slash Commands)

```bash
# List what's installed
agents commands list

# Install from a git repo
agents commands add gh:user/my-prompts

# Remove
agents commands remove my-command
```

### MCP Servers

```bash
# List servers across all agents
agents mcp list

# Add stdio server (use -- before the command)
agents mcp add swarm -- npx @swarmify/agents-mcp
agents mcp add memory -- npx -y @anthropic-ai/mcp-memory

# Add HTTP server with headers
agents mcp add api https://api.example.com/mcp --transport http -H "Authorization:Bearer token"

# Remove from all agents
agents mcp remove swarm
```

### Hooks

```bash
# List hooks
agents hooks list

# Install from repo
agents hooks add gh:user/my-hooks

# Remove
agents hooks remove my-hook
```

### Skills

Agent Skills are reusable capabilities (SKILL.md + rules/) that agents can invoke.

```bash
# List installed skills
agents skills list

# Install from repo
agents skills add gh:user/my-skills

# Show details
agents skills info my-skill
```

### Search & Install from Registries

Search public registries for MCP servers and skills:

```bash
# Search all registries
agents search github
agents search filesystem --limit 10

# Filter by type
agents search github --type mcp

# Install from registry (auto-detected)
agents add mcp:io.github.bytedance/mcp-server-filesystem

# Or use identifiers
agents add skill:user/my-skill    # Skill from git
agents add gh:user/my-repo        # Git repo directly
```

### Registry Management

```bash
# List configured registries
agents registry list

# Add custom registry
agents registry add mcp myregistry https://api.example.com/v1

# Configure API key
agents registry config mcp myregistry --api-key YOUR_KEY

# Disable/enable
agents registry disable mcp myregistry
agents registry enable mcp myregistry

# Remove
agents registry remove mcp myregistry
```

Default registries:
- `official` (MCP): https://registry.modelcontextprotocol.io

### Sync

```bash
# Pull config from your .agents repo
agents pull gh:username/.agents

# Push local changes back
agents push

# Full status
agents status
```

### CLI Management

```bash
# Show installed versions
agents cli list

# Upgrade all to latest
agents cli upgrade --latest
```

## Filtering

All commands support `--agent` and `--scope` filters:

```bash
agents commands list --agent claude
agents mcp list --scope project
agents skills list --agent codex --scope user
```

## Scopes

| Scope | Location | Use Case |
|-------|----------|----------|
| User | `~/.{agent}/` | Available everywhere |
| Project | `./.{agent}/` | This repo only |

Promote project-scoped items to user scope:

```bash
agents commands push my-command
agents mcp push my-server
```

## Supported Agents

| Agent | Prompts | MCP | Hooks | Skills |
|-------|---------|-----|-------|--------|
| Claude Code | Yes | Yes | Yes | Yes |
| Codex | Yes | Yes | - | Yes |
| Gemini CLI | Yes (TOML) | Yes | Yes | Yes |
| Cursor | Yes | - | - | - |
| OpenCode | Yes | - | - | - |
| Trae | Yes | - | - | - |

## Your .agents Repo

```
.agents/
  agents.yaml           # CLIs, MCP servers, defaults
  shared/commands/      # Prompts for all agents
  claude/commands/      # Claude-specific prompts
  claude/hooks/         # Claude hooks
  skills/               # Agent Skills
```

## Related

- [@swarmify/agents-mcp](https://www.npmjs.com/package/@swarmify/agents-mcp) - Multi-agent orchestration MCP server

## License

MIT
