# @swarmify/agents-mcp

MCP server enabling SubAgents and Swarms for any MCP client. Any client (Claude, Codex, Gemini) can spawn any agent CLI.

## Cross-Platform Architecture

```
                         MCP Protocol
                              |
        +---------------------+---------------------+
        |                     |                     |
   Claude Code             Codex                Gemini CLI
   (MCP Client)         (MCP Client)          (MCP Client)
        |                     |                     |
        +---------------------+---------------------+
                              |
                    +-------------------+
                    |   agents-mcp      |
                    | (MCP Server)      |
                    +-------------------+
                              |
        +---------------------+---------------------+
        |                     |                     |
   claude CLI            codex CLI            gemini CLI
   (SubAgent)            (SubAgent)           (SubAgent)
```

**Any client can spawn any agent.** Claude can spawn Codex. Gemini can spawn Claude. The MCP protocol is the universal interface.

## Package Overview

This server provides four MCP tools for agent lifecycle management:
- `Spawn` - Start an agent (returns immediately for non-blocking pattern)
- `Status` - Get progress with delta-based cursor polling
- `Stop` - Stop one agent or all in a task
- `Tasks` - List all tasks sorted by recent activity

Pure infrastructure - no decision-making. The orchestrator handles scheduling, task assignment, and conflict resolution.

## Multi-Agent Patterns

This server enables two patterns:

**SubAgents** - Hierarchical delegation. Orchestrator spawns specialized agents for specific tasks. Each agent works in isolation and reports back.

**Swarms** - Parallel execution. Multiple agents work simultaneously on different parts of a problem. Orchestrator assigns non-overlapping files and synthesizes results.

Both patterns use the same tools. The orchestrator decides the pattern based on the task.

## Repository Structure

```
/src
  index.ts          # MCP server entry point
  server.ts         # MCP tool registration and handler routing
  api.ts            # Tool handlers (spawn, status, stop, tasks)
  agents.ts         # AgentManager class - core lifecycle management
  parsers.ts        # Normalize 5 agent formats into unified events
  persistence.ts    # Config/disk storage at ~/.agents/
  summarizer.ts     # Compress events, delta polling
  ralph.ts         # Ralph mode config and prompt building
  version.ts        # Version checking with npm registry
  file_ops.ts       # Extract file ops from bash commands
/tests              # 17 test files (no mocks, real services only)
/testdata            # Fixtures for parser tests
```

## Core Architecture

### AgentManager Class

Located in `agents.ts` (line 618+), manages agent lifecycle:

- **State tracking**: running, completed, failed, stopped
- **Limits enforcement**: maxAgents (50), maxConcurrent (10)
- **Auto-cleanup**: removes agents older than 7 days
- **Process groups**: SIGTERM/SIGKILL propagate to all child processes
- **Persistence**: loads existing agents from disk on startup
- **Filtering**: optional `filterByCwd` to only see agents in specific directory

### Event Normalization (parsers.ts)

Each agent CLI logs differently. Parsers normalize to unified event format:

**Agent parsers:**
- `normalizeCodex()` - parses Codex JSONL format
- `normalizeClaude()` - parses Claude stream-json format
- `normalizeGemini()` - parses Gemini stream-json format
- `normalizeCursor()` - parses Cursor stream-json format
- `normalizeOpencode()` - parses OpenCode JSON format

**Critical gotcha:** Codex `payload.arguments` is a JSON string, not an object. Must `JSON.parse()` before accessing.

**Unified event types:** `init`, `message`, `bash`, `file_read`, `file_write`, `file_delete`, `thinking`, `tool_use`, `turn_start`, `result`

### Delta Polling (summarizer.ts)

Optimizes Status tool to minimize token usage:

- **Cursor-based**: `since` timestamp returns only new events since last call
- **Collapses sequential events**: thinking deltas, message deltas
- **Deduplicates file ops**: sets of created/modified/read/deleted paths
- **Truncates bash commands**: 120 chars max (heredocs become `cat <<EOF > path`)
- **Error extraction**: scans last 20 raw events for error keywords

## MCP Tools

### Spawn Tool

**Handler:** `handleSpawn()` in `api.ts`

**Parameters:**
| Parameter | Required | Description |
|-----------|-----------|-------------|
| `task_name` | Yes | Groups related agents (e.g., "auth-feature") |
| `agent_type` | Yes | `claude`, `codex`, `gemini`, `cursor`, `opencode` |
| `prompt` | Yes | Task for the agent |
| `mode` | No | `plan` (read-only, default), `edit` (write), `ralph` (autonomous) |
| `cwd` | No | Working directory for agent |
| `effort` | No | `fast`, `default`, `detailed` - maps to agent models |

**Returns immediately** with `agent_id`. Don't call Status right away - wait 2+ minutes for agent to do work.

### Status Tool

**Handler:** `handleStatus()` in `api.ts`

**Parameters:**
| Parameter | Required | Description |
|-----------|-----------|-------------|
| `task_name` | Yes | Task to check |
| `filter` | No | `running` (default), `completed`, `failed`, `stopped`, `all` |

**Returns:**
- Agent status (running, completed, failed, stopped)
- Files created/modified/read/deleted (deduplicated sets)
- Bash commands executed (truncated to 120 chars)
- Last 5 messages (not full history)
- Cursor timestamp (send back in next call for delta)

### Stop Tool

**Handler:** `handleStop()` in `api.ts`

**Parameters:**
| Parameter | Required | Description |
|-----------|-----------|-------------|
| `task_name` | Yes | Task to stop |
| `agent_id` | No | Optional specific agent ID (if omitted, stops all in task) |

Sends SIGTERM to process group. If process doesn't exit in 10s, sends SIGKILL.

### Tasks Tool

**Handler:** `handleTasks()` in `api.ts`

**Parameters:**
| Parameter | Required | Description |
|-----------|-----------|-------------|
| `limit` | No | Max tasks to return (default: 10) |

Lists all tasks sorted by most recent activity (latest completion time or current time if running).

## Agent Modes

### Plan Mode (default, read-only)

For research, exploration, code review. Agent cannot write files.

| Agent | Plan Mode Flags |
|-------|----------------|
| Claude | `--permission-mode plan` |
| Codex | sandboxed (no `--full-auto`) |
| Gemini | no auto-approve flags |
| Cursor | no auto-approve flags |
| OpenCode | no write permissions |

### Edit Mode (read + write)

For implementation, refactoring, fixes. Agent can write files.

| Agent | Edit Mode Flags |
|-------|----------------|
| Claude | `acceptEdits` (prompt suffix) |
| Codex | `--full-auto` |
| Gemini | `--yolo` |
| Cursor | `-f` |
| OpenCode | write permissions |

### Ralph Mode (autonomous)

Spawns ONE agent with full permissions and instructions to work through all tasks in a `RALPH.md` file.

**RALPH.md format:**
```markdown
## [ ] Implement user authentication

Add JWT-based auth to backend.

### Updates

---

## [x] Add rate limiting

Protect endpoints from abuse.

### Updates
- Added middleware with sliding window counter
- Completed: All endpoints protected
```

**How it works:**
1. Create `RALPH.md` in your project directory with tasks
2. Call `Spawn(mode='ralph', cwd='./my-project', prompt='Build auth')`
3. Agent reads RALPH.md, understands system, picks tasks logically
4. For each task: completes work, marks `## [ ]` to `## [x]`, adds update
5. Continues until all tasks checked or stopped

**Safety:**
- Scoped by `cwd` - orchestrator controls blast radius
- Warns if used in dangerous paths (home dir, `/`, `/System`, `/usr`, etc.)
- RALPH.md must exist before spawn

## Agent Discovery & Configuration

### Auto-Discovery at Startup

Checks which agent CLIs are installed using `checkCliAvailable()` in `agents.ts`:
- Executes `which <cli>` command
- Returns `[available: boolean, pathOrError: string | null]`
- Enabled agents appear in Spawn tool description

### Config Location

**Primary:** `~/.agents/swarm/config.json`
**Legacy fallback:** `~/.agents/config.json`, `~/.swarmify/agents/config.json`
**Temp fallback:** `/tmp/agents/` (if others not writable)

### Agent Config Structure

```json
{
  "agents": {
    "claude": {
      "command": "claude -p '{prompt}' --output-format stream-json --json",
      "enabled": true,
      "models": {
        "fast": "claude-haiku-4-5-20251001",
        "default": "claude-sonnet-4-5",
        "detailed": "claude-opus-4-5"
      },
      "provider": "anthropic"
    },
    "codex": {
      "command": "codex exec --sandbox workspace-write '{prompt}' --json",
      "enabled": true,
      "models": {
        "fast": "gpt-4o-mini",
        "default": "gpt-5.2-codex",
        "detailed": "gpt-5.1-codex-max"
      },
      "provider": "openai"
    },
    "gemini": {
      "command": "gemini '{prompt}' --output-format stream-json",
      "enabled": true,
      "models": {
        "fast": "gemini-3-flash-preview",
        "default": "gemini-3-flash-preview",
        "detailed": "gemini-3-pro-preview"
      },
      "provider": "google"
    },
    "cursor": {
      "command": "cursor-agent -p --output-format stream-json '{prompt}'",
      "enabled": false,
      "models": {
        "fast": "composer-1",
        "default": "composer-1",
        "detailed": "composer-1"
      },
      "provider": "custom"
    },
    "opencode": {
      "command": "opencode run --format json '{prompt}'",
      "enabled": false,
      "models": {
        "fast": "zai-coding-plan/glm-4.7-flash",
        "default": "zai-coding-plan/glm-4.7",
        "detailed": "zai-coding-plan/glm-4.7"
      },
      "provider": "custom"
    }
  }
}
```

## Storage & Persistence

### Directory Structure

```
~/.agents/swarm/
  config.json          # Agent configuration
  cache.json           # Version cache (12h TTL)
  agents/
    {agent-id}/
      metadata.json     # task_name, type, mode, status, timestamps
      stdout.log       # Raw agent output (streamed line by line)
```

### AgentProcess.loadFromDisk()

Located in `agents.ts`, called during AgentManager initialization:

1. Reads all directories in `~/.agents/swarm/agents/`
2. Loads `metadata.json` for each
3. Filters by age (cleans up older than cleanupAgeDays, default 7)
4. Filters by `cwd` if `filterByCwd` is set
5. Checks if process is still running via `updateStatusFromProcess()`
6. Adds to internal `agents` Map

### Metadata Schema

```typescript
{
  agent_id: string,        // UUID
  task_name: string,       // Task grouping
  agent_type: AgentType,   // claude, codex, gemini, cursor, opencode
  mode: Mode,              // plan, edit, ralph
  cwd: string | null,      // Working directory
  status: AgentStatus,      // running, completed, failed, stopped
  started_at: Date,
  completed_at: Date | null,
  parent_session_id: string | null,
  workspace_dir: string | null
}
```

## Effort Levels (Model Mapping)

Effort levels map to agent-specific models via `resolveEffortModelMap()` in `agents.ts`.

| Level | Claude | Codex | Gemini | Cursor | OpenCode |
|-------|---------|-------|---------|--------|----------|
| fast | claude-haiku-4-5-20251001 | gpt-4o-mini | gemini-3-flash-preview | composer-1 | zai-coding-plan/glm-4.7-flash |
| default | claude-sonnet-4-5 | gpt-5.2-codex | gemini-3-flash-preview | composer-1 | zai-coding-plan/glm-4.7 |
| detailed | claude-opus-4-5 | gpt-5.1-codex-max | gemini-3-pro-preview | composer-1 | zai-coding-plan/glm-4.7 |

Effort is passed to Spawn tool and resolved to model name via agent config.

## Critical Gotchas

### Codex JSON Arguments
Codex `payload.arguments` field is a JSON **string**, not an object. Must `JSON.parse(payload.arguments)` before accessing.

**Bad:** `const args = item.payload.arguments.command;`
**Good:** `const args = JSON.parse(item.payload.arguments); const cmd = args.command;`

### Spawn Returns Immediately
Spawn tool returns `agent_id` right away - agent runs in background. Don't call Status immediately. Wait 2+ minutes for agent to make progress.

### Delta Polling
Always send `since` cursor from last Status response to avoid redundant token usage. Status without `since` returns all events (expensive).

### Detached Processes
Agents are spawned as detached background processes. They survive IDE restarts. Reconnect via Status/Tasks tools after restarting IDE.

### Ralph Mode Safety
Ralph mode warns if `cwd` is a dangerous path:
- User home directory
- `/`, `/System`, `/usr`, `/bin`, `/sbin`, `/etc`

RALPH.md must exist in `cwd` before spawning ralph agent.

### Process Groups
Agent CLI is spawned with process group. SIGTERM/SIGKILL terminate entire process tree (including bash child processes).

## Testing Strategy

### No Mocks
All tests use real services. No mocks, stubs, or fakes.

### Test Fixtures
Live test fixtures in `tests/testdata/` subdirectory:
- `claude-agent-log-comprehensive.jsonl` - Real Claude session
- `claude-summary-comprehensive.jsonl` - Real summary data
- `codex-*` - Real Codex sessions
- `gemini-*` - Real Gemini sessions
- `cursor-*` - Real Cursor sessions

### Test Files

| File | Purpose |
|------|---------|
| `test_agents.test.ts` | AgentManager lifecycle, spawn, stop, cleanup |
| `test_api.test.ts` | MCP tool handlers (spawn, status, stop, tasks) |
| `test_parsers.test.ts` | Event normalization for all agent types |
| `test_summarizer.test.ts` | Event collapsing, delta calculation |
| `test_ralph.test.ts` | Ralph mode config, dangerous path detection |
| `test_server.test.ts` | MCP server initialization, tool registration |
| `test_version.test.ts` | Version checking, npm registry fetching |
| `test_mcp_e2e.test.ts` | End-to-end MCP protocol tests |
| `test_claude_live.test.ts` | Live Claude agent execution |
| `test_codex_live.test.ts` | Live Codex agent execution |
| `test_gemini_live.test.ts` | Live Gemini agent execution |
| `test_cursor_live.test.ts` | Live Cursor agent execution |
| `test_opencode_live.test.ts` | Live OpenCode agent execution |

### Running Tests

```bash
cd agents-mcp
bun install
bun test
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGENTS_MCP_DEFAULT_MODE` | Set default mode (`plan` or `edit`). Overrides server default. |
| `AGENTS_MCP_RALPH_FILE` | Task file name for ralph mode (default: `RALPH.md`) |
| `AGENTS_MCP_DISABLE_RALPH` | Disable ralph mode (set to `true` or `1`) |

## Version Checking

### Version Cache

Located at `~/.agents/swarm/cache.json`:
```json
{
  "version": {
    "latest": "0.2.6",
    "checkedAt": 17051234567890
  }
}
```

### Check Logic

1. Load cache from disk (`loadCache()` in `version.ts`)
2. If cache is fresh (< 12h TTL), use cached version
3. Otherwise, fetch from npm registry (3s timeout)
4. Update cache with latest version and timestamp
5. Compare `current` vs `latest` - if outdated, build notice

### Notice Building

If version is outdated, `buildVersionNotice()` appends message to tool descriptions:
```
[New version available: 0.2.7, you are running 0.2.6. Run 'npx -y @swarmify/agents-mcp@latest' to update.]
```

### Client Detection

`detectClientFromName()` in `version.ts` identifies which agent CLI is calling:
- Claude: checks for `AGENT_SESSION_ID` env var
- Codex, Gemini: detected from process name or environment

## File Operation Inference (file_ops.ts)

`extractFileOpsFromBash()` parses bash command strings to extract file read/write/delete operations:

**Write patterns:** `cat > path`, `echo >> path`, `sed -i path`, `tee path`
**Read patterns:** `head path`, `tail path`, `cat path | grep`, `sed -n path`
**Delete patterns:** `rm path`, `rm -rf path`

Returns three arrays: `[filesRead, filesWritten, filesDeleted]`

Used by parsers to track file operations from bash tool calls, even when agent doesn't explicitly log file operations.

## What This Server Does NOT Do

| Not This | That's The Orchestrator's Job |
|----------|-------------------------------|
| Scheduling | Decides when to spawn which agents |
| Task assignment | Writes prompts, defines what to do |
| Conflict resolution | Assigns non-overlapping files to agents |
| Intelligence | Pure infrastructure - no decision-making |

This server is the pipes and wires. Orchestrators are the intelligence.
