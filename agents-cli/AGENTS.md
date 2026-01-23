# agents-cli Development Guide

## Architecture

```
src/
  index.ts              # CLI entry point, all commands
  lib/
    types.ts            # Core types (AgentId, Manifest, State)
    agents.ts           # Agent configs, CLI detection, MCP ops
    manifest.ts         # agents.yaml parsing/serialization
    state.ts            # ~/.agents/state.json management
    git.ts              # Git clone/pull operations
    skills.ts           # Skill discovery and installation
    convert.ts          # Markdown <-> TOML conversion
```

## Key Types

```typescript
type AgentId = 'claude' | 'codex' | 'gemini' | 'cursor' | 'opencode' | 'trae';

interface Manifest {
  clis?: Partial<Record<AgentId, CliConfig>>;
  dependencies?: Record<string, string>;
  mcp?: Record<string, McpServerConfig>;
  defaults?: { method?: 'symlink' | 'copy'; scope?: 'global' | 'project'; agents?: AgentId[] };
}

interface State {
  version: string;
  lastSync: string | null;
  source: string | null;
  clis: Partial<Record<AgentId, CliState>>;
  packages: Record<string, PackageState>;
  skills: Record<string, SkillState>;
  mcp: Record<string, McpState>;
}
```

## Agent Configuration

Each agent has different paths and formats. See `AGENTS` object in `lib/agents.ts`:

| Agent | Commands Dir | Format | MCP Support |
|-------|--------------|--------|-------------|
| Claude | `~/.claude/commands/` | markdown | Yes |
| Codex | `~/.codex/prompts/` | markdown | Yes |
| Gemini | `~/.gemini/prompts/` | toml | Yes |
| Cursor | `~/.cursor-agent/prompts/` | markdown | No |
| OpenCode | `~/.opencode/prompts/` | markdown | No |
| Trae | `~/.trae/prompts/` | markdown | No |

## Critical Patterns

### Scope System

Commands and MCPs can exist at two scopes:

| Scope | Location | Use Case |
|-------|----------|----------|
| User | `~/.{agent}/` | Available globally, all projects |
| Project | `./.{agent}/` | Project-specific, committed to repo |

Key functions:
```typescript
// lib/skills.ts (manages commands/prompts)
listInstalledCommandsWithScope(agentId, cwd) -> InstalledCommand[]
promoteCommandToUser(agentId, name, cwd) -> { success, error? }

// lib/agents.ts
listInstalledMcpsWithScope(agentId, cwd) -> InstalledMcp[]
promoteMcpToUser(agentId, name, cwd) -> { success, error? }
```

### Command Discovery

Commands are discovered from repo in this order:
1. `shared/commands/*.md` - Shared across all agents
2. `{agent}/{commandsSubdir}/*` - Agent-specific

Agent-specific commands override shared commands with the same name.

### Format Conversion

Gemini requires TOML format. When installing a markdown skill to Gemini:

```typescript
// lib/convert.ts
markdownToToml(skillName, markdownContent) -> tomlContent
```

The conversion:
- Extracts frontmatter description
- Converts `$ARGUMENTS` to `{{args}}`
- Wraps prompt in TOML triple-quoted string

### MCP Registration

Each agent has different MCP registration commands:

```typescript
// lib/agents.ts
registerMcp(agentId, serverName, command, scope)
unregisterMcp(agentId, serverName)
isMcpRegistered(agentId, serverName)
```

Claude/Codex use `claude mcp add` / `codex mcp add`.
Gemini uses config file modification.

### Git Source Parsing

Sources can be specified as:
- `gh:user/repo` - GitHub shorthand
- `https://github.com/user/repo` - Full URL
- `/path/to/local` - Local directory

```typescript
// lib/git.ts
parseSource(source) -> { type: 'github' | 'url' | 'local', url: string, ref?: string }
```

## State Management

State is persisted to `~/.agents/state.json`:

```typescript
// lib/state.ts
readState() -> State
writeState(state)
updateState(partial) -> State
```

Always use these functions - they handle directory creation and defaults.

## Adding a New Agent

1. Add to `AgentId` type in `lib/types.ts`
2. Add config to `AGENTS` object in `lib/agents.ts`
3. Add to `ALL_AGENT_IDS` array
4. If MCP capable, add to `MCP_CAPABLE_AGENTS`
5. Implement any custom detection in `isCliInstalled()`

## Adding a New Command

Commands are defined in `index.ts` using Commander.js:

```typescript
program
  .command('mycommand <arg>')
  .description('What it does')
  .option('-f, --flag', 'Description')
  .action(async (arg, options) => {
    // Implementation
  });
```

For subcommands:

```typescript
const myCmd = program.command('my').description('Parent command');
myCmd.command('sub').action(() => { ... });
```

## Testing

Test commands manually:

```bash
bun run build
node dist/index.js status
node dist/index.js pull -y --dry-run /path/to/repo
```

## Dependencies

- `commander` - CLI framework
- `chalk` - Terminal colors
- `ora` - Spinners
- `@inquirer/prompts` - Interactive prompts
- `simple-git` - Git operations
- `yaml` - YAML parsing
- `semver` - Version comparison

## Build

```bash
bun install
bun run build    # Compiles to dist/
```

## File Locations

### Global State

| Item | Path |
|------|------|
| State | `~/.agents/state.json` |
| Cloned repos | `~/.agents/repos/` |
| External packages | `~/.agents/packages/` |

### User Scope (global)

| Item | Path |
|------|------|
| Claude commands | `~/.claude/commands/` |
| Claude MCP config | `~/.claude/settings.json` |
| Codex prompts | `~/.codex/prompts/` |
| Codex MCP config | `~/.codex/config.json` |
| Gemini commands | `~/.gemini/commands/` |
| Gemini MCP config | `~/.gemini/settings.json` |

### Project Scope (per-directory)

| Item | Path |
|------|------|
| Claude commands | `./.claude/commands/` |
| Claude MCP config | `./.claude/settings.json` |
| Codex prompts | `./.codex/prompts/` |
| Codex MCP config | `./.codex/config.json` |
| Gemini commands | `./.gemini/commands/` |
| Gemini MCP config | `./.gemini/settings.json` |
