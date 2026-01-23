# Swarmify - Multi-Agent Coding Framework

True multi-agent coding in your IDE. Run Claude, Codex, Gemini, and Cursor agents side-by-side with your code.

## Architecture

```
+------------------+     +------------------+     +------------------+
|   Claude Code    |     |      Codex       |     |      Gemini      |
+--------+---------+     +--------+---------+     +--------+---------+
         |                        |                        |
         +------------------------+------------------------+
                                  |
                    +-------------+-------------+
                    |     Swarmify MCP Server   |
                    |   (Agent Orchestration)   |
                    +-------------+-------------+
                                  |
                    +-------------+-------------+
                    |    VS Code / Cursor IDE   |
                    |  (Extension: Editor Tabs) |
                    +---------------------------+
```

## Repository Structure

| Directory | Package | Purpose |
|-----------|---------|---------|
| `agents-mcp/` | @swarmify/agents-mcp | MCP server for spawning agents |
| `extension/` | swarm-ext | VS Code/Cursor extension |
| `prompts/` | - | Slash commands for all agents |
| `extension/src/core/mcp/` | - | MCP client implementations (GitHub, Linear, auth, storage) |

## Core Concepts

### Agent Types

| Agent | CLI | Strength | Best For |
|-------|-----|----------|----------|
| Claude | `claude` | Maximum capability, research, exploration | Complex research, open-ended exploration |
| Codex | `codex` | Fast, cheap | Self-contained features |
| Gemini | `gemini` | Complex multi-system features | Architectural changes |
| Cursor | `cursor-agent` | Debugging, bug fixes | Tracing through codebases |

### Agent Modes

| Mode | File Access | Auto-loops? | Use Case |
|------|-------------|-------------|----------|
| `plan` | Read-only | No | Research, exploration, code review |
| `edit` | Read + Write | No | Implementation, refactoring, fixes |
| `ralph` | Full yolo | Yes | Autonomous iteration through RALPH.md tasks |

Default is `plan` for safety.

### Agent Orchestration

Agents can spawn other agents via MCP tools:
- Claude can spawn Codex for a quick fix while continuing analysis
- Orchestrator assigns tasks, prevents conflicts by splitting work by file
- Subagents run asynchronously - orchestrator polls for progress

## Hard Rules

CROSSING ANY OF THESE HARD LINES EVEN ONCE WILL RESULT IN IMMEDIATE AND PERMANENT TERMINATION OF THE PROFESSIONAL RELATIONSHIP BETWEEN THE USER AND CLAUDE.

### 1. NO EMOJIS, ICONS, OR DECORATIVE SYMBOLS
Not in code. Not in comments. Not in commits. Not in UI text. Not in any file. No checkmarks. No stars. No sparkles. No visual flair of any kind.
**Exception:** User explicitly confirms 3+ times with phrases like "YES I REALLY WANT EMOJIS".

### 2. NO MOCKING IN TESTS
All tests must use real services. No mocks. No stubs. No fakes. End-to-end testing with real execution.

### 3. NO ENV VARS FOR USER CREDENTIALS OR INFRASTRUCTURE
Never use environment variables for:
- User tokens, OAuth keys, personal data
- Infrastructure URLs (proxy URLs, API endpoints) - HARDCODE THESE
**Only OK:** Server-side API keys in .env files
For user credentials: use Keychain, encrypted config files, or secure storage.

### 4. NO GIT COMMANDS
Never run any git command. Not git status. Not git log. Not git add. Not git commit. Not git reset. Not git push. Nothing. The user manages all git operations manually.

### 5. NO TESTS IN /TMP
Tests belong in the codebase, not /tmp. Never write tests, test scripts, or verification code to /tmp. If you need to verify something works, write a proper test that can be rerun.

### 6. NO BACKGROUND SHELLS
Never use `run_in_background: true` with the Bash tool. Background shells accumulate and crash. All commands must run in the foreground.

### 7. NO TOASTS
Never use toast notifications in UI. Operations must either work silently (one-click, no feedback) or show inline errors (red text near the action). Success is assumed.
**Exception:** Critical system errors that require immediate user attention.

## Development Defaults

- Package manager: bun (not npm/yarn/pnpm)
- TypeScript only (no plain JS)
- Python: loguru for logging, built-in type hints
- Env files: .env.dev and .env.prod (not .env.example)
- Async-first for disk/network IO
- Minimal libraries
- Extend existing code over writing new

## Code Style

- No comments unless explicitly requested
- Test fixtures in `testdata/` subdirectory (same directory as test file)
- One test file per concern
- Go tests MUST use testify: `require.NoError(t, err)` not `if err != nil { t.Fatal(err) }`

## Tech Stack

- Frontend: Node v24, Next.js, Bun, React, Tailwind, zustand, lucide-react
- Backend: Python 3.12, FastAPI, uv, pydantic, loguru, Supabase/Postgres
- MCP: @modelcontextprotocol/sdk

## Architecture Patterns

### Agent Spawning (Swarm MCP)
Use Swarm MCP tools: `spawn`, `status`, `stop`, `tasks`
- Spawn agents FIRST before other work (parallelism)
- Agents execute, you architect - delegate with specific context
- Do NOT use built-in Claude Code Task tool when Swarm agents are requested

### Session Activity Parsing
Live activity extraction from agent session files to show what agents are doing in Dashboard.

**Agent formats** (critical - each agent logs differently):

| Agent | Tool Call Event | Tool Name Field | Args Field |
|-------|-----------------|-----------------|------------|
| Claude | `type: "assistant"` with `message.content[].type: "tool_use"` | `name` | `input` object |
| Codex | `type: "response_item"` with `payload.type: "function_call"` | `payload.name` | `payload.arguments` (JSON string!) |
| Gemini | `type: "tool_call"` | `tool_name` | `parameters` object |

**Codex gotcha:** Arguments are a JSON STRING, not an object. Must `JSON.parse(payload.arguments)`.

### Tmux Socket Pinning
Each tmux session uses a dedicated socket (`/tmp/agents-tmux-{session}.sock`) to ensure `terminal.sendText()` and `execAsync()` talk to the same server. Split operations use `execAsync()` directly to bypass terminal input.

## Critical Gotchas

### Agent ID Formats
Three different formats are used interchangeably:
- UI: `claude`, `codex`, `gemini`, `cursor`
- AgentConfig: `Claude`, `Codex`, `Gemini`, `Cursor`
- Terminal names: `CC`, `CX`, `GX`, `CR`
- Prefix constants (in utils.ts): CC=Claude, CX=Codex, GX=Gemini, OC=OpenCode, CR=Cursor, SH=Shell

Map between them carefully.

### Terminal Tracking
- Internal map (`editorTerminals`) may be stale after VS Code restart
- Always scan `vscode.window.terminals` directly when needed
- `scanExisting()` extracts env vars (`AGENT_TERMINAL_ID`, `AGENT_SESSION_ID`) to restore session tracking

### Webview Reload
Set `retainContextWhenHidden: true` or panel reloads on focus loss.

### Session Restoration
Extracts both env vars from VS Code terminals at startup:
- `AGENT_TERMINAL_ID`: Internal tracking ID (`CC-1705123456789-1`)
- `AGENT_SESSION_ID`: CLI session UUID (`4a78949e-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

## File Locations

| Item | Location |
|------|----------|
| Extension settings | VS Code globalState |
| Swarm config | `~/.agents/config.json` |
| Agent prompts | `~/.swarmify/agents/prompts.json` |
| Agent logs | `~/.agents/agents/{id}/stdout.log` |
| Claude session files | `~/.claude/projects/{workspace}/*.jsonl` |
| Codex session files | `~/.codex/sessions/{year}/{month}/{day}/*.jsonl` |
| Gemini session files | `~/.gemini/sessions/*.jsonl` |

## Package-Specific Notes

### agents-mcp (@swarmify/agents-mcp)
- MCP server for spawning agents (Spawn, Status, Stop, Tasks tools)
- Auto-discovers which agent CLIs are installed at startup
- Agents run as detached background processes (survive IDE restarts)
- Storage: `~/.agents/`
- Config: `~/.agents/config.json`

### extension (swarm-ext)
- VS Code extension for managing agent terminals
- 166 tests, no mocks
- Commands: `bun run compile`, `bun test`
- Key features:
  - Agent terminals as editor tabs (not bottom panel)
  - Dashboard with Overview, Swarm, Prompts, Guide tabs
  - Tmux mode for per-tab splits (Cmd+Shift+H/V)
  - Autogit for automated commits (Ctrl+Shift+G)

### extension/src/core/mcp/
MCP client implementations for:
- GitHub (`github-client.ts`)
- Linear (`linear-client.ts`)
- Auth (`auth.ts`)
- Storage (`storage.ts`)
- Base client (`client.ts`)

## Behavior Tables

For tricky features with multiple scenarios, show a behavior table to verify correctness:

```
| showLabelsInTitles | labelReplacesTitle | Session | Label | Result |
|--------------------|-------------------|---------|-------|--------|
| false | any | any | any | Claude or Claude 12345678 |
| true | false (default) | no | yes | Claude - auth feature |
| true | false (default) | yes | yes | Claude 12345678 - auth feature |
| true | true | no | yes | auth feature |
| true | true | yes | yes | Claude 12345678 - auth feature |
```

This makes edge cases explicit and prevents misunderstandings.

## Documentation Maintenance

After implementing major features (new modules, architectural changes, new data flows):
1. Check if an AGENTS.md exists in the affected directory
2. If yes, update it with high-level design changes
3. Skip for bug fixes, refactors, or small changes - only architectural details matter

## Subagent Spawning Rules

When spawning agents:
1. Use Swarm MCP tools, not built-in Task agent
2. Spawn agents FIRST before other work (they run in background)
3. Provide specific file paths WITH line numbers from your exploration
4. Include code patterns inline - don't say "look at X for patterns"
5. Include concrete examples of expected output/structure
6. Agents execute, you architect - never delegate exploration

## Ralph Mode

Ralph mode spawns ONE agent with full permissions and instructions to autonomously work through all tasks in a `RALPH.md` file.

**RALPH.md format:**

```markdown
## [ ] Task title

Task description

### Updates

---

## [x] Completed task

Task description

### Updates
- Progress note 1
- Progress note 2
```

**How it works:**
1. Create a `RALPH.md` file in your project directory with tasks
2. Call `Spawn(mode='ralph', cwd='./my-project', prompt='Build the system')`
3. MCP spawns ONE agent with full permissions
4. Agent reads RALPH.md, understands the system, picks tasks logically
5. For each task: completes work, marks checkbox `## [x]`, adds update
6. Continues until all tasks checked (or you stop it with Stop tool)

## Terminal Titles

Terminal tab titles are constructed from prefix + sessionChunk + label. User preferences control display:

| Setting | Effect |
|---------|--------|
| `showFullAgentNames` | `CC` vs `Claude` |
| `showSessionIdInTitles` | Include first 8 chars of session UUID |
| `showLabelsInTitles` | Include user-set label |
| `labelReplacesTitle` | Label replaces full title vs appends with dash |

**Key identifiers** (stored in terminal env vars):
- `AGENT_TERMINAL_ID`: Internal tracking ID
- `AGENT_SESSION_ID`: CLI session UUID
- `sessionChunk`: First 8 chars of sessionId, shown in tab title
