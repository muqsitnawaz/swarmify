# agents-cli Development Guide

## Architecture

```
src/
  index.ts              # CLI entry point, all commands
  lib/
    types.ts            # Core types (AgentId, Manifest, State, Registry)
    agents.ts           # Agent configs, CLI detection, MCP ops
    manifest.ts         # agents.yaml parsing/serialization
    state.ts            # ~/.agents/meta.yaml management
    git.ts              # Git clone/pull operations
    hooks.ts            # Hook discovery and installation
    commands.ts         # Slash command discovery and installation
    skills.ts           # Agent Skills (SKILL.md + rules/) management
    convert.ts          # Markdown <-> TOML conversion
    registry.ts         # Package registry client (MCP, skills)
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

Commands, skills, hooks, and MCPs can exist at two scopes:

| Scope | Location | Use Case |
|-------|----------|----------|
| User | `~/.{agent}/` | Available globally, all projects |
| Project | `./.{agent}/` | Project-specific, committed to repo |

Key functions:
```typescript
// lib/commands.ts (manages slash commands/prompts)
listInstalledCommandsWithScope(agentId, cwd) -> InstalledCommand[]
promoteCommandToUser(agentId, name, cwd) -> { success, error? }

// lib/skills.ts (manages Agent Skills)
listInstalledSkillsWithScope(agentId, cwd) -> InstalledSkill[]
promoteSkillToUser(agentId, name, cwd) -> { success, error? }

// lib/hooks.ts
listInstalledHooksWithScope(agentId, cwd) -> InstalledHook[]
promoteHookToUser(agentId, name, cwd) -> { success, error? }

// lib/agents.ts
listInstalledMcpsWithScope(agentId, cwd) -> InstalledMcp[]
promoteMcpToUser(agentId, name, cwd) -> { success, error? }
```

### Agent Skills vs Slash Commands

| Aspect | Slash Commands | Agent Skills |
|--------|----------------|--------------|
| Location | `~/.agents/commands/` | `~/.agents/skills/` |
| Structure | Single `.md` file | Directory: `SKILL.md` + `rules/*.md` |
| Invocation | `/plan`, `/debug` | Via `Skill` tool interface |
| Library | `lib/commands.ts` | `lib/skills.ts` |
| Discovery | `discoverCommands()` | `discoverSkillsFromRepo()` |

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

### Package Registries

Registries are URL-based indexes for discovering MCP servers and skills.

```typescript
// lib/registry.ts
getRegistries(type: 'mcp' | 'skill') -> Record<string, RegistryConfig>
getEnabledRegistries(type) -> Array<{ name, config }>
searchMcpRegistries(query, options?) -> RegistrySearchResult[]
getMcpServerInfo(name, registry?) -> McpServerEntry | null
resolvePackage(identifier) -> ResolvedPackage | null
parsePackageIdentifier(id) -> { type, name }
```

Package identifier prefixes:
- `mcp:name` - Search MCP registries
- `skill:user/repo` - Skill (falls back to git)
- `gh:user/repo` - Git source directly

Default registries defined in `DEFAULT_REGISTRIES` (types.ts):
- `mcp.official`: https://registry.modelcontextprotocol.io/v0

Registry config stored in `~/.agents/meta.yaml` under `registries` key.

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
| State | `~/.agents/meta.yaml` |
| Cloned repos | `~/.agents/repos/` |
| External packages | `~/.agents/packages/` |
| Agent Skills | `~/.agents/skills/` |

### User Scope (global)

| Item | Path |
|------|------|
| Claude commands | `~/.claude/commands/` |
| Claude skills | `~/.claude/skills/` |
| Claude MCP config | `~/.claude/settings.json` |
| Codex prompts | `~/.codex/prompts/` |
| Codex skills | `~/.codex/skills/` |
| Codex MCP config | `~/.codex/config.json` |
| Gemini commands | `~/.gemini/commands/` |
| Gemini skills | `~/.gemini/skills/` |
| Gemini MCP config | `~/.gemini/settings.json` |

### Project Scope (per-directory)

| Item | Path |
|------|------|
| Claude commands | `./.claude/commands/` |
| Claude skills | `./.claude/skills/` |
| Claude MCP config | `./.claude/settings.json` |
| Codex prompts | `./.codex/prompts/` |
| Codex skills | `./.codex/skills/` |
| Codex MCP config | `./.codex/config.json` |
| Gemini commands | `./.gemini/commands/` |
| Gemini skills | `./.gemini/skills/` |
| Gemini MCP config | `./.gemini/settings.json` |
