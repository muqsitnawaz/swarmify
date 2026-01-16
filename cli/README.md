# @swarmify/cli

CLI tool for syncing skills across AI coding agents (Claude, Codex, Gemini, Cursor).

## Problem

Each AI coding CLI stores skills/commands in their own directory:
- Claude: `~/.claude/commands/`
- Codex: `~/.codex/prompts/`
- Gemini: `~/.gemini/commands/`
- Cursor: `~/.cursor/commands/`

This is redundant and makes it hard to keep skills in sync across agents.

## Solution

This CLI provides a single source of truth for skills at `~/.swarmify/skills/` and syncs them to all agent directories automatically, handling format conversion (e.g., markdown to TOML for Gemini).

## Installation

```bash
npm install -g @swarmify/cli
```

Or run directly with npx:
```bash
npx @swarmify/cli status
```

## Usage

### Initialize skills directory

```bash
swarm-cli init
```

Creates `~/.swarmify/skills/` with templates for all available skills.

### Check status

```bash
swarm-cli status
```

Shows which skills are installed for each agent:

```
Skills Status

Skill         claude      codex       gemini      cursor      Source
----------------------------------------------------------------------
swarm         installed   installed   installed   installed   yes
plan          builtin     installed   installed   -           yes
...
```

### Sync skills to all agents

```bash
swarm-cli sync
```

Copies skills from `~/.swarmify/skills/` to each agent's directory.

Options:
- `--skill <name>` - Sync a specific skill only
- `--agent <name>` - Sync to a specific agent only
- `--dry-run` - Preview what would be synced

### List available skills

```bash
swarm-cli list
```

### Show agent CLI status

```bash
swarm-cli agents
```

Shows which agent CLIs are installed and configured.

### Show paths

```bash
swarm-cli paths
```

Shows all relevant directory paths.

## Skill Format

Skills are written in Markdown and stored in `~/.swarmify/skills/`:

```markdown
You are a multi-agent orchestrator...

## Instructions

1. Break complex tasks into parallel subtasks
2. Spawn specialized agents for each subtask
...
```

The CLI automatically converts to TOML format for Gemini.

## Adding Custom Skills

1. Create a new `.md` file in `~/.swarmify/skills/`
2. Add the skill definition to `src/skills.ts` (for agent support matrix)
3. Run `swarm-cli sync`

## Development

```bash
cd cli
npm install
npm run dev -- status  # Run with tsx
npm run build          # Build TypeScript
```
